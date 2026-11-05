"""PDF sources as visual evidence: guarded direct download, per-page text maps, page rendering and the crop target.

A PDF cited by the agent (a manufacturer's data sheet or manual) is downloaded directly, without Firecrawl credits.
Its text, extracted with PDFium (pypdfium2, Apache-2.0/BSD-3-Clause), is what the agent reads, and every page gets a
text map in the same shape as ``capture_scripts/dom_map.js`` (document coordinates in PDF points, origin at the top
left), so the crop code of web pages applies unchanged to the page rendered at twice its size.

Blocks are visual rows: the text segments that share a line. Cells of a table row are one block, so an excerpt that
crosses columns (model, voltage, barcode) is cropped as a single piece, and the agent sees the row as ``a | b | c``.

Scanned PDFs (no text layer) can be read by an injected :class:`DocumentParser` (``ai_parse_document`` on the job,
``brickfill.pdf_ocr``); without one they keep the rendered page as the capture and get ``NO_MATCH``.
"""

from __future__ import annotations

import asyncio
import ipaddress
import math
import re
import socket
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urljoin, urlsplit

import httpx

MAX_PDF_BYTES = 30 * 1024 * 1024
MAX_PDF_PAGES = 250
MAX_REDIRECTS = 6
RENDER_SCALE = 2.0
MAX_RENDER_PIXELS = 40_000_000
# Text segments whose vertical centers are this close (in points, and within most of the line height) share a row.
ROW_TOLERANCE_PT = 14.0
PDF_SIGNATURE = b"%PDF-"
BLOCKED_SUFFIXES = (".local", ".internal", ".localhost", ".lan", ".home", ".corp", ".intranet", ".arpa")

# PDFium is not thread-safe: every call into it goes through this lock.
_PDFIUM = threading.Lock()

Resolver = Callable[[str, int], Awaitable[list[str]]]


class PdfRefused(ValueError):
    """The PDF cannot be used as visual evidence (blocked address, too large, encrypted, not a PDF...)."""


async def _resolve(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def check_public_url(url: str, resolve: Resolver | None = None) -> None:
    """Only HTTPS on port 443 to a host that resolves exclusively to public addresses."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise PdfRefused("PDF download only over HTTPS")
    try:
        port = parts.port or 443
    except ValueError as exc:
        raise PdfRefused("Invalid PDF address") from exc
    if port != 443:
        raise PdfRefused("PDF download only on port 443")
    host = (parts.hostname or "").rstrip(".").casefold()
    if not host or "." not in host or host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise PdfRefused("PDF host is not a public name")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    try:
        addresses = [str(literal)] if literal else await (resolve or _resolve)(host, port)
    except OSError as exc:  # socket.gaierror: the name does not resolve
        raise PdfRefused("PDF host does not resolve") from exc
    if not addresses:
        raise PdfRefused("PDF host does not resolve")
    for address in addresses:
        try:
            parsed = ipaddress.ip_address(address.split("%")[0])
        except ValueError as exc:
            raise PdfRefused("PDF host resolves to an invalid address") from exc
        if not parsed.is_global:
            raise PdfRefused("PDF host resolves to a non-public address")


def _check_signature(content: bytes) -> None:
    # a few servers send whitespace or a byte order mark before the signature
    if PDF_SIGNATURE not in content[:1024]:
        raise PdfRefused("The address does not serve a PDF")


async def fetch_pdf(
    url: str,
    http: httpx.AsyncClient,
    *,
    resolve: Resolver | None = None,
    max_bytes: int = MAX_PDF_BYTES,
) -> tuple[bytes, str]:
    """Download a PDF (content, final URL) with redirects followed by hand, each hop checked like the first one."""
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        await check_public_url(current, resolve)
        async with http.stream(
            "GET", current, headers={"Accept": "application/pdf,*/*;q=0.5"}, follow_redirects=False
        ) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("location")
                if not location:
                    raise PdfRefused("PDF redirect without a location")
                current = urljoin(current, location)
                continue
            if response.status_code >= 400:
                raise PdfRefused(f"PDF download answered HTTP {response.status_code}")
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise PdfRefused("PDF exceeds the download size limit")
            parts: list[bytes] = []
            total = 0
            checked = False
            async for part in response.aiter_bytes():
                total += len(part)
                if total > max_bytes:
                    raise PdfRefused("PDF exceeds the download size limit")
                parts.append(part)
                if not checked and total >= 1024:
                    _check_signature(b"".join(parts))  # stop early on an HTML page
                    checked = True
            content = b"".join(parts)
            _check_signature(content)
            return content, current
    raise PdfRefused("Too many redirects for the PDF download")


# --- text map ---------------------------------------------------------------------------------------------------


@dataclass
class _Segment:
    text: str
    left: float
    top: float
    right: float
    bottom: float

    @property
    def center(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def height(self) -> float:
        return self.bottom - self.top


def rows_from_segments(segments: list[_Segment]) -> list[list[_Segment]]:
    """Group segments into visual rows (top to bottom), each row left to right."""
    rows: list[list[_Segment]] = []
    for segment in sorted(segments, key=lambda item: (item.center, item.left)):
        if rows:
            row = rows[-1]
            center = sum(item.center for item in row) / len(row)
            height = max(max(item.height for item in row), segment.height)
            if abs(segment.center - center) <= min(ROW_TOLERANCE_PT, 0.75 * height):
                row.append(segment)
                continue
        rows.append([segment])
    return [sorted(row, key=lambda item: item.left) for row in rows]


def _row_cells(row: list[_Segment]) -> list[str]:
    """Cells of a row: segments separated by a gap wider than about two characters are different columns."""
    cells: list[list[_Segment]] = []
    for segment in row:
        if cells and segment.left - cells[-1][-1].right <= max(segment.height, 4.0) * 1.2:
            cells[-1].append(segment)
        else:
            cells.append([segment])
    return [" ".join(item.text for item in cell) for cell in cells]


def geometry_from_rows(rows: list[list[_Segment]], width: float, height: float, href: str) -> dict[str, Any]:
    blocks = []
    for row in rows:
        context = " ".join(" ".join(_row_cells(row)).split())
        if not context:
            continue
        left, top = min(item.left for item in row), min(item.top for item in row)
        right, bottom = max(item.right for item in row), max(item.bottom for item in row)
        blocks.append({"text": context, "context": context, "box": [left, top, right - left, bottom - top]})
    return {
        "href": href,
        "width": width,
        "height": height,
        "viewportWidth": width,
        "viewportHeight": height,
        "scrollX": 0,
        "scrollY": 0,
        "blocks": blocks,
    }


@dataclass
class PdfPageMap:
    number: int  # 1-based
    geometry: dict[str, Any]
    markdown_lines: list[str]
    # PNG of the page: rendered on demand from the PDF, or given by the OCR parser
    image: bytes | None = None
    image_path: str | None = None
    coordinates_path: str | None = None


@dataclass
class OcrPage:
    """One page read by a :class:`DocumentParser`: its image and the text blocks in that image's pixels."""

    image: bytes
    width: float
    height: float
    blocks: list[dict[str, Any]] = field(default_factory=list)  # {"text": ..., "box": [left, top, width, height]}


class DocumentParser(Protocol):
    def parse(self, pdf_path: str, max_pages: int) -> list[OcrPage]: ...


def _pdfium():
    import pypdfium2
    import pypdfium2.raw

    return pypdfium2, pypdfium2.raw


class PdfSource:
    """A downloaded PDF: per-page text maps, the markdown the agent reads, and page images."""

    def __init__(self, content: bytes, url: str, pages: list[PdfPageMap], title: str = "", ocr: bool = False):
        self.content = content
        self.url = url
        self.pages = pages
        self.title = title
        self.ocr = ocr

    @classmethod
    def open(cls, content: bytes, url: str, max_pages: int = MAX_PDF_PAGES) -> PdfSource:
        pdfium, raw = _pdfium()
        with _PDFIUM:
            try:
                document = pdfium.PdfDocument(content)
            except pdfium.PdfiumError as exc:
                raise PdfRefused(f"The PDF cannot be opened: {exc}") from exc
            try:
                if raw.FPDF_GetSecurityHandlerRevision(document.raw) != -1:
                    raise PdfRefused("Encrypted PDFs are not used as visual evidence")
                if len(document) > max_pages:
                    raise PdfRefused(f"The PDF has more than {max_pages} pages")
                title = str(document.get_metadata_value("Title") or "").strip()
                pages = [cls._page_map(document, index, url) for index in range(len(document))]
            finally:
                document.close()
        return cls(content, url, pages, title)

    @staticmethod
    def _page_map(document: Any, index: int, url: str) -> PdfPageMap:
        page = document[index]
        try:
            left, bottom, right, top = page.get_cropbox()
            rotated = page.get_rotation() % 360 != 0
            width, height = right - left, top - bottom
            segments: list[_Segment] = []
            textpage = page.get_textpage()
            try:
                for rect in range(textpage.count_rects()):
                    x0, y0, x1, y1 = textpage.get_rect(rect)
                    text = " ".join(textpage.get_text_bounded(x0, y0, x1, y1).split())
                    if text and x1 > x0 and y1 > y0:
                        segments.append(_Segment(text, x0 - left, top - y1, x1 - left, top - y0))
            finally:
                textpage.close()
        finally:
            page.close()
        rows = rows_from_segments(segments)
        href = f"{url}#page={index + 1}"
        # a rotated page renders turned while its text coordinates are not: no crop is attempted on it
        geometry = geometry_from_rows([] if rotated else rows, width, height, href)
        lines = [" | ".join(_row_cells(row)) for row in rows]
        return PdfPageMap(index + 1, geometry, lines)

    @property
    def has_text(self) -> bool:
        return any(page.geometry["blocks"] for page in self.pages)

    @property
    def text(self) -> str:
        return "\n".join(line for page in self.pages for line in page.markdown_lines)

    def markdown(self) -> str:
        parts = []
        for page in self.pages:
            if page.markdown_lines:
                parts.append(f"## Page {page.number}\n\n" + "\n".join(page.markdown_lines))
        return "\n\n".join(parts) or "(This PDF has no text layer: it is a scanned document.)"

    def apply_ocr(self, parser: DocumentParser, pdf_path: str, max_pages: int) -> None:
        """Replace the (empty) text maps with what the parser read; pages it returns carry their own images."""
        read = parser.parse(pdf_path, max_pages)
        pages = []
        for number, item in enumerate(read, start=1):
            blocks = [
                {"text": text, "context": text, "box": [float(value) for value in block["box"]]}
                for block in item.blocks
                if (text := " ".join(str(block.get("text", "")).split()))
            ]
            geometry = {
                "href": f"{self.url}#page={number}",
                "width": item.width,
                "height": item.height,
                "viewportWidth": item.width,
                "viewportHeight": item.height,
                "scrollX": 0,
                "scrollY": 0,
                "blocks": blocks,
            }
            # the agent reads a table one row per line; the block that locates a value keeps it on a single line
            lines = [
                line
                for block in item.blocks
                for line in (" ".join(row.split()) for row in str(block.get("text", "")).splitlines())
                if line
            ]
            pages.append(PdfPageMap(number, geometry, lines, image=item.image))
        if pages:
            self.pages = pages
            self.ocr = True

    def image(self, number: int) -> bytes:
        """PNG of a page (rendered at twice its size, less for very large pages); cached."""
        page = self.pages[number - 1]
        if page.image is None:
            page.image = self._render(number)
        return page.image

    def _render(self, number: int) -> bytes:
        import io

        pdfium, _raw = _pdfium()
        geometry = self.pages[number - 1].geometry
        area = max(1.0, float(geometry["width"]) * float(geometry["height"]))
        scale = min(RENDER_SCALE, math.sqrt(MAX_RENDER_PIXELS / area))
        with _PDFIUM:
            document = pdfium.PdfDocument(self.content)
            try:
                page = document[number - 1]
                try:
                    bitmap = page.render(scale=scale, fill_color=(255, 255, 255, 255))
                    image = bitmap.to_pil()
                finally:
                    page.close()
            finally:
                document.close()
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        return buffer.getvalue()


# --- locating the cited value ---------------------------------------------------------------------------------------


def _tokens(text: str) -> set[str]:
    return {token for token in re.findall(r"\w+", text.casefold()) if len(token) > 1}


@dataclass
class PdfTarget:
    """Where to crop a value: the page, and the text map to crop from (``None``: the value was not located)."""

    page: int
    geometry: dict[str, Any] | None
    status: str = "COMPLETE"  # outcome of locating: COMPLETE (one block), AMBIGUOUS or NO_MATCH
    reason: str = ""


def locate(
    source: PdfSource,
    excerpt: str,
    value: str,
    cells: list[str],
    label: str = "",
) -> PdfTarget:
    """The page and text map that identify the value: the page where the quote matches one block, else the block
    with the value whose row also names the attribute (``label``), else the page sharing most words with the quote."""
    from brickfill.visual_evidence import _contains as contains
    from brickfill.visual_evidence import _quoted_blocks as quoted_blocks

    ambiguous: list[tuple[int, list[dict[str, Any]]]] = []
    for page in source.pages:
        boxes = quoted_blocks(page.geometry, excerpt, value, cells)
        if len(boxes) == 1:
            return PdfTarget(page.number, page.geometry)
        if boxes:
            ambiguous.append(
                (page.number, [block for block in page.geometry["blocks"] if tuple(block["box"]) in boxes])
            )
    # Retry line by line: among the rows with the value, the one that also names the attribute.
    if label.strip():
        labelled = [
            (number, block)
            for number, blocks in ambiguous
            for block in blocks
            if contains(block.get("context", ""), label)
        ]
        if not ambiguous:
            labelled = [
                (page.number, block)
                for page in source.pages
                for block in page.geometry["blocks"]
                if contains(block.get("context", ""), value) and contains(block.get("context", ""), label)
            ]
        if len(labelled) == 1:
            number, block = labelled[0]
            geometry = {**source.pages[number - 1].geometry, "blocks": [block]}
            return PdfTarget(number, geometry)
    if ambiguous:
        return PdfTarget(
            ambiguous[0][0], None, "AMBIGUOUS", "PDF: the value appears in more than one place of the document."
        )
    wanted = _tokens(excerpt) | _tokens(value)
    best = max(source.pages, key=lambda page: len(wanted & _tokens(" ".join(page.markdown_lines))), default=None)
    reason = (
        "PDF: the value was not found in the document's text."
        if source.has_text
        else "PDF: no text layer (scanned document); the page is kept for review."
    )
    return PdfTarget(best.number if best else 1, None, "NO_MATCH", reason)
