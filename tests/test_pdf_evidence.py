"""PDF sources as visual evidence: synthetic PDFs written here, fake HTTP (httpx.MockTransport) and fake DNS."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
from pathlib import Path

import httpx
import pytest
from PIL import Image

from brickfill.models import VisualEvidence
from brickfill.pdf_evidence import (
    OcrPage,
    PdfRefused,
    PdfSource,
    check_public_url,
    fetch_pdf,
    locate,
)
from brickfill.visual_evidence import CaptureCollector, EvidenceArchive

PDF_URL = "https://maker.example.com/docs/x100-datasheet.pdf"
PUBLIC_IP = "93.184.215.14"
PADDING = bytes.fromhex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A")


def _rc4(key: bytes, data: bytes) -> bytes:
    box = list(range(256))
    j = 0
    for i in range(256):
        j = (j + box[i] + key[i % len(key)]) % 256
        box[i], box[j] = box[j], box[i]
    i = j = 0
    out = bytearray()
    for byte in data:
        i = (i + 1) % 256
        j = (j + box[i]) % 256
        box[i], box[j] = box[j], box[i]
        out.append(byte ^ box[(box[i] + box[j]) % 256])
    return bytes(out)


def make_pdf(pages: list[list[tuple[float, float, float, str]]], *, encrypted: bool = False) -> bytes:
    """A PDF with Helvetica text lines (x, y from the top, size, text) on 612x792 pt pages; an empty page list
    entry gives a page without a text layer. ``encrypted``: standard security handler, revision 2, no password."""
    objects: list[bytes | None] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    objects.append(None)
    pages_id = len(objects)
    kids = []
    for lines in pages:
        ops = []
        for x, y, size, text in lines:
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"BT /F1 {size} Tf {x} {792 - y} Td ({escaped}) Tj ET")
        stream = "\n".join(ops).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(
            add(
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> "
                b"/Contents %d 0 R >>" % (pages_id, font, content)
            )
        )
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % kid for kid in kids),
        len(kids),
    )
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    trailer_extra = b""
    if encrypted:
        file_id = b"0123456789abcdef"
        owner = _rc4(hashlib.md5(PADDING).digest()[:5], PADDING)
        permissions = -4
        key = hashlib.md5(PADDING + owner + permissions.to_bytes(4, "little", signed=True) + file_id).digest()[:5]
        user = _rc4(key, PADDING)
        encrypt = add(
            b"<< /Filter /Standard /V 1 /R 2 /O <%s> /U <%s> /P %d >>"
            % (owner.hex().encode(), user.hex().encode(), permissions)
        )
        trailer_extra = b" /Encrypt %d 0 R /ID [<%s> <%s>]" % (encrypt, file_id.hex().encode(), file_id.hex().encode())
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + (body or b"") + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R%s >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        catalog,
        trailer_extra,
        xref,
    )
    return bytes(out)


DATASHEET = [
    [(72, 72, 18, "Acme X100 Impact Drill"), (72, 110, 11, "Professional drill for masonry and steel.")],
    [
        (72, 72, 14, "Technical data"),
        (72, 110, 10, "Model"),
        (200, 110, 10, "Voltage"),
        (320, 110, 10, "Power"),
        (420, 110, 10, "EAN"),
        (72, 125, 10, "X100A"),
        (200, 125, 10, "220V"),
        (320, 125, 10, "750 W"),
        (420, 125, 10, "7891234567888"),
        (72, 140, 10, "X100B"),
        (200, 140, 10, "127V"),
        (320, 140, 10, "750 W"),
        (420, 140, 10, "7891234567895"),
        (72, 170, 10, "Chuck: 13 mm"),
    ],
]


async def public_dns(host: str, port: int) -> list[str]:
    return [PUBLIC_IP]


def run(coroutine):
    return asyncio.run(coroutine)


# --- text maps --------------------------------------------------------------------------------------------------


def test_pages_have_row_blocks_and_table_markdown():
    source = PdfSource.open(make_pdf(DATASHEET), PDF_URL)
    assert len(source.pages) == 2 and source.has_text
    contexts = [block["context"] for block in source.pages[1].geometry["blocks"]]
    assert "X100B 127V 750 W 7891234567895" in contexts
    assert "X100B | 127V | 750 W | 7891234567895" in source.markdown()
    assert source.markdown().startswith("## Page 1")
    geometry = source.pages[1].geometry
    assert (geometry["width"], geometry["height"]) == (612, 792)
    left, top, width, height = next(b["box"] for b in geometry["blocks"] if b["context"].startswith("X100B"))
    assert 70 <= left <= 74 and 140 - 12 <= top <= 140 and width > 300 and 0 < height < 14


def test_rendered_page_is_twice_the_page_size():
    source = PdfSource.open(make_pdf(DATASHEET), PDF_URL)
    with Image.open(io.BytesIO(source.image(2))) as image:
        assert image.size == (1224, 1584)


def test_locate_picks_the_page_and_the_row():
    source = PdfSource.open(make_pdf(DATASHEET), PDF_URL)
    target = locate(source, "X100B 127V 750 W 7891234567895", "127V", ["X100B", "127V", "750 W", "7891234567895"])
    assert target.page == 2 and target.geometry is not None
    # "750 W" is in both rows: ambiguous, unless the attribute's label settles it (it does not here)
    assert locate(source, "750 W", "750 W", [], "Power").status == "AMBIGUOUS"
    # line by line with the label: "Chuck" names one row only
    target = locate(source, "Chuck size 13 mm", "13 mm", [], "Chuck")
    assert target.page == 2 and target.geometry["blocks"][0]["context"] == "Chuck: 13 mm"


def test_encrypted_and_oversized_pdfs_are_refused():
    with pytest.raises(PdfRefused, match="Encrypted"):
        PdfSource.open(make_pdf(DATASHEET, encrypted=True), PDF_URL)
    with pytest.raises(PdfRefused, match="more than 1 pages"):
        PdfSource.open(make_pdf(DATASHEET), PDF_URL, max_pages=1)


# --- guarded download ------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://maker.example.com/a.pdf",
        "https://maker.example.com:8443/a.pdf",
        "https://localhost/a.pdf",
        "https://files.corp.internal/a.pdf",
        "https://printer.local/a.pdf",
        "https://10.0.0.5/a.pdf",
        "https://[::1]/a.pdf",
    ],
)
def test_non_public_addresses_are_refused(url):
    with pytest.raises(PdfRefused):
        run(check_public_url(url, public_dns))


def test_name_resolving_to_a_private_address_is_refused():
    async def private_dns(host, port):
        return [PUBLIC_IP, "169.254.169.254"]

    with pytest.raises(PdfRefused, match="non-public"):
        run(check_public_url(PDF_URL, private_dns))


def download(handler, resolve=public_dns, **options):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await fetch_pdf(PDF_URL, http, resolve=resolve, **options)

    return run(go())


def test_redirect_to_a_private_address_is_refused():
    def handler(request):
        if request.url.host == "maker.example.com":
            return httpx.Response(302, headers={"location": "https://internal.example.net/x.pdf"})
        return httpx.Response(200, content=make_pdf(DATASHEET))

    async def dns(host, port):
        return ["192.168.0.10"] if host == "internal.example.net" else [PUBLIC_IP]

    with pytest.raises(PdfRefused, match="non-public"):
        download(handler, dns)


def test_redirects_are_followed_and_checked():
    def handler(request):
        if request.url.path.endswith("x100-datasheet.pdf"):
            return httpx.Response(301, headers={"location": "/docs/v2/x100.pdf"})
        return httpx.Response(200, content=make_pdf(DATASHEET))

    content, final_url = download(handler)
    assert content.startswith(b"%PDF-") and final_url == "https://maker.example.com/docs/v2/x100.pdf"


def test_too_many_redirects_are_refused():
    with pytest.raises(PdfRefused, match="redirects"):
        download(lambda request: httpx.Response(302, headers={"location": PDF_URL}))


def test_size_limit_on_declared_and_streamed_length():
    with pytest.raises(PdfRefused, match="size limit"):
        download(lambda request: httpx.Response(200, headers={"content-length": str(10**9)}, content=b"%PDF-"))
    with pytest.raises(PdfRefused, match="size limit"):
        download(lambda request: httpx.Response(200, content=b"%PDF-" + b"0" * 5000), max_bytes=4096)


def test_content_that_is_not_a_pdf_is_refused():
    with pytest.raises(PdfRefused, match="does not serve a PDF"):
        download(lambda request: httpx.Response(200, content=b"<!doctype html><html>" + b" " * 3000))


# --- capture and crop -------------------------------------------------------------------------------------------


def collector_for(tmp_path: Path, content: bytes, monkeypatch, parser=None):
    calls: list[str] = []

    def handler(request):
        calls.append(str(request.url))
        assert request.url.host != "api.firecrawl.dev", "a direct PDF must not use Firecrawl credits"
        return httpx.Response(200, content=content)

    async def go():
        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
            CaptureCollector(
                "fc-key", EvidenceArchive(str(tmp_path)), "run-1", http_client=http, pdf_parser=parser
            ) as collector,
        ):
            payload = await collector.scrape({"url": PDF_URL})
            return collector, payload

    monkeypatch.setattr("brickfill.pdf_evidence._resolve", public_dns)
    return run(go()), calls


def reference(excerpt: str) -> VisualEvidence:
    return VisualEvidence(evidence_id="ev-1", url=PDF_URL, excerpt=excerpt, capture_status="NOT_CAPTURED")


def test_pdf_value_is_cropped_from_its_table_row(tmp_path, monkeypatch):
    (collector, payload), calls = collector_for(tmp_path, make_pdf(DATASHEET), monkeypatch)
    assert calls == [PDF_URL]
    page = collector.pages[PDF_URL]
    assert page.status == "CAPTURED" and page.credits == 0
    data = json.loads(json.loads(payload)["content"][0]["text"])
    assert data["metadata"]["contentType"] == "application/pdf"
    assert "X100B | 127V | 750 W | 7891234567895" in data["markdown"]

    result = collector.crop(reference("X100B | 127V | 750 W | 7891234567895"), "127V", "Voltage")
    assert result.capture_status == "COMPLETE", result.capture_error
    assert result.screenshot_path.endswith("/page-2.png") and result.coordinates_path.endswith("/page-2.json")
    left, top, right, bottom = result.crop_box
    assert right - left > 600 and 50 < bottom - top < 80  # the whole row at twice the page size, with padding
    assert Path(result.text_path).name == "source.pdf"


def test_pdf_without_the_value_keeps_the_rendered_page(tmp_path, monkeypatch):
    (collector, _payload), _calls = collector_for(tmp_path, make_pdf(DATASHEET), monkeypatch)
    result = collector.crop(reference("Battery: 18 V"), "18 V", "Battery")
    assert result.capture_status == "NO_MATCH"
    assert result.capture_error.startswith("PDF: ")
    assert result.screenshot_path and result.crop_path is None


def test_scanned_pdf_without_a_parser_is_no_match(tmp_path, monkeypatch):
    (collector, payload), _calls = collector_for(tmp_path, make_pdf([[]]), monkeypatch)
    assert "no text layer" in json.loads(json.loads(payload)["content"][0]["text"])["markdown"]
    result = collector.crop(reference("Power: 750 W"), "750 W", "Power")
    assert result.capture_status == "NO_MATCH" and "no text layer" in result.capture_error
    assert result.screenshot_path


class FakeParser:
    """What ai_parse_document gives back for a scanned page: its image and the blocks in its pixels."""

    def __init__(self):
        self.calls = []

    def parse(self, pdf_path: str, max_pages: int) -> list[OcrPage]:
        self.calls.append((pdf_path, max_pages))
        image = Image.new("RGB", (1200, 1600), "white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return [OcrPage(buffer.getvalue(), 1200, 1600, [{"text": "Power: 750 W", "box": [100, 300, 400, 40]}])]


def test_scanned_pdf_read_by_the_parser_is_cropped(tmp_path, monkeypatch):
    parser = FakeParser()
    (collector, payload), _calls = collector_for(tmp_path, make_pdf([[]]), monkeypatch, parser)
    assert parser.calls and parser.calls[0][0].endswith("source.pdf")
    assert "Power: 750 W" in json.loads(json.loads(payload)["content"][0]["text"])["markdown"]
    result = collector.crop(reference("Power: 750 W"), "750 W", "Power")
    assert result.capture_status == "COMPLETE", result.capture_error
    assert result.crop_box == [88, 288, 512, 352]


def test_credit_limited_recapture_never_pays_for_a_pdf(tmp_path, monkeypatch):
    def handler(request):
        assert request.url.host != "api.firecrawl.dev"
        return httpx.Response(403)

    async def go():
        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
            CaptureCollector("fc-key", EvidenceArchive(str(tmp_path)), "run-1", max_credits=1, http_client=http) as c,
        ):
            await c.scrape({"url": PDF_URL})
            return c

    monkeypatch.setattr("brickfill.pdf_evidence._resolve", public_dns)
    page = run(go()).pages[PDF_URL]
    assert page.status == "UNSUPPORTED" and "HTTP 403" in page.error


def test_ai_parse_document_result_becomes_page_blocks():
    from brickfill.pdf_ocr import pages_from_parsed

    image = Image.new("RGB", (1000, 1400), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    document = {
        "document": {
            "pages": [{"id": 0, "image_uri": "/Volumes/c/s/v/run/ocr/page0.png"}],
            "elements": [
                {"type": "title", "content": "Acme X100", "bbox": [{"coord": [50, 40, 400, 90], "page_id": 0}]},
                {
                    "type": "table",
                    "content": "<table><tr><td>Power</td><td>750 W</td></tr><tr><td>Chuck</td><td>13 mm</td></tr>"
                    "</table>",
                    "bbox": [{"coord": [50, 200, 900, 400], "page_id": 0}],
                },
                {"type": "page_footer", "content": "Page 1", "bbox": [{"coord": [50, 1300, 200, 1350], "page_id": 0}]},
            ],
        },
        "error_status": None,
    }
    read = []
    pages = pages_from_parsed(document, lambda uri: read.append(uri) or buffer.getvalue())
    assert read == ["/Volumes/c/s/v/run/ocr/page0.png"]
    assert (pages[0].width, pages[0].height) == (1000, 1400)
    assert pages[0].blocks == [
        {"text": "Acme X100", "box": [50.0, 40.0, 350.0, 50.0]},
        {"text": "Power | 750 W Chuck | 13 mm", "box": [50.0, 200.0, 850.0, 200.0]},
    ]
    with pytest.raises(ValueError, match="failed"):
        pages_from_parsed({"error_status": [{"error_message": "boom"}]}, lambda uri: b"")


def test_name_that_does_not_resolve_is_refused():
    import socket

    async def no_dns(host, port):
        raise socket.gaierror(8, "nodename nor servname provided, or not known")

    with pytest.raises(PdfRefused, match="does not resolve"):
        run(check_public_url(PDF_URL, no_dns))


def test_failed_scrape_of_a_web_page_survives_the_pdf_fallback(tmp_path, monkeypatch):
    """A failed scrape tries the address as a PDF; a host that does not resolve leaves the scrape error."""
    import socket

    async def no_dns(host, port):
        raise socket.gaierror(8, "nodename nor servname provided, or not known")

    async def go():
        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(500))) as http,
            CaptureCollector("fc-key", EvidenceArchive(str(tmp_path)), "run-1", http_client=http) as collector,
        ):
            await collector.scrape({"url": "https://shop.example.com/p/1"})
            return collector

    monkeypatch.setattr("brickfill.pdf_evidence._resolve", no_dns)
    page = run(go()).pages["https://shop.example.com/p/1"]
    assert page.status == "FAILED" and "500" in page.error
