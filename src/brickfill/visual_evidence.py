from __future__ import annotations

import asyncio
import contextlib
import hashlib
import html
import io
import json
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from databricks.sdk.errors import DatabricksError
from PIL import Image
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential
from typing_extensions import Self

from brickfill.errors import safe_exception_message
from brickfill.issues import make
from brickfill.models import ProductEnrichment, Severity, ValidationIssue, VisualEvidence
from brickfill.research import canonicalize_url

MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_IMAGE_PIXELS = 60_000_000
EVIDENCE_COLUMNS = {
    "run_id": "STRING",
    "source_run_id": "STRING",
    "capture_mode": "STRING",
    "ean": "STRING",
    "attribute_code": "STRING",
    "attribute_name": "STRING",
    "attribute_value": "STRING",
    "candidate_value": "STRING",
    "evidence_id": "STRING",
    "capture_id": "STRING",
    "url": "STRING",
    "final_url": "STRING",
    "source_title": "STRING",
    "source_tier": "STRING",
    "fact_name": "STRING",
    "fact_value": "STRING",
    "excerpt": "STRING",
    "captured_at": "TIMESTAMP",
    "screenshot_path": "STRING",
    "crop_path": "STRING",
    "text_path": "STRING",
    "coordinates_path": "STRING",
    "crop_box_json": "STRING",
    "screenshot_sha256": "STRING",
    "crop_sha256": "STRING",
    "capture_status": "STRING",
    "capture_error": "STRING",
}

CAPTURE_SCRIPTS = Path(__file__).parent / "capture_scripts"
_NO_LIMIT = contextlib.nullcontext()


def _script(name: str, argument: Any = None) -> str:
    """JavaScript of capture_scripts/<name>.js (an arrow function), called with one JSON argument."""
    source = (CAPTURE_SCRIPTS / f"{name}.js").read_text(encoding="utf-8")
    body = "\n".join(line for line in source.splitlines() if not line.startswith("//")).strip()
    return f"({body})({json.dumps(argument, ensure_ascii=False) if argument is not None else ''})"


DOM_SCRIPT = _script("dom_map")
DISMISS_SCRIPT = _script("dismiss")
EXPAND_SCRIPT = _script("expand")
SCROLL_BOTTOM_SCRIPT = _script("scroll", "bottom")
SCROLL_TOP_SCRIPT = _script("scroll", "top")


def _key(text: str) -> str:
    return " ".join(text.casefold().split())


MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
MARKDOWN_MARKUP = re.compile(r"\*\*|__|`|\||^\s*(?:#{1,6}|[-*+]|>)\s+", re.MULTILINE)


def _visible_excerpt(excerpt: str) -> str:
    """The text a reader sees for an excerpt quoted from Firecrawl's markdown (tables, bold, headings, links)."""
    return MARKDOWN_MARKUP.sub(" ", MARKDOWN_LINK.sub(r"\1", excerpt))


def _contains(text: str, value: str) -> bool:
    return bool(value.strip()) and re.search(r"(?<!\w)" + re.escape(_key(value)) + r"(?!\w)", _key(text)) is not None


def crop_value(excerpt: str | None, *values: str | None) -> str:
    """What to look for on the page: the first value the quote shows as written, else the quote itself.

    The model often normalizes a value ("387 Litros", "2 vidro + 1 plástico") that the page writes differently
    ("387 l", "2 (Vidro Temperado) + 1 (Plástico)"); the excerpt is a verbatim quote, so it locates the block instead.
    """
    visible = _visible_excerpt(excerpt or "").strip()
    for value in values:
        if value and (not visible or _contains(visible, value)):
            return value
    return visible


STABLE_TOLERANCE_PX = 2.0
# Values that the focused capture tries again (a full-page FAILED only counts when the page itself was captured).
FOCUS_STATUSES = {"NO_MATCH", "AMBIGUOUS", "SCREENSHOT_ONLY", "FAILED"}
MAX_FOCUS_TARGETS = 6  # one paid scrape per page; 7 actions per value


def table_cells(excerpt: str | None) -> list[str]:
    """The cells of an excerpt quoted from a markdown table row ("Model | NR-X1 | 127V"), else nothing."""
    if not excerpt or "|" not in excerpt:
        return []
    return [cell for part in excerpt.split("|") if len(_key(cell := _visible_excerpt(part).strip(" -"))) >= 2]


def _quoted_blocks(
    geometry: dict[str, Any], excerpt: str, value: str, cells: list[str] | None = None
) -> set[tuple[float, ...]]:
    """Boxes of the visible blocks that show the value and match the quoted excerpt.

    A block matches when it contains the whole excerpt or, for an excerpt that spans several rows of a table or list,
    when the block (with the value) is itself part of the excerpt. For a quoted table row (``cells``), whose markdown
    may carry cells the page does not show, a block also matches when it holds the value's cell and another cell of
    the quote.
    """
    blocks = [block for block in geometry.get("blocks", []) if _contains(block.get("context", ""), value)]
    if not excerpt.strip():
        return {tuple(block["box"]) for block in blocks}
    containing = {tuple(block["box"]) for block in blocks if _contains(block.get("context", ""), excerpt)}
    # A block that is only the value (e.g. a lone "175 W" elsewhere on the page) says nothing about the quote.
    found = containing or {
        tuple(block["box"])
        for block in blocks
        if _contains(excerpt, block.get("context", "")) and _key(block.get("context", "")) != _key(value)
    }
    value_cells = [cell for cell in cells or [] if _contains(cell, value)]
    anchors = [cell for cell in cells or [] if cell not in value_cells]
    if found or not value_cells or not anchors:
        return found
    return {
        tuple(block["box"])
        for block in blocks
        if any(_contains(block.get("context", ""), cell) for cell in value_cells)
        and any(_contains(block.get("context", ""), cell) for cell in anchors)
    }


def _stable(
    box: tuple[float, ...],
    geometry: dict[str, Any],
    previous: dict[str, Any] | None,
    excerpt: str,
    value: str,
    cells: list[str] | None = None,
) -> bool:
    """The cropped block must be at the same place before and after the screenshot.

    A scrollbar that appears during the capture narrows the document and shifts centered content horizontally by
    half of that difference, so that shift is tolerated; any other movement (lazy loading, carousels, sticky headers
    over the excerpt) is not.
    """
    if previous is None:
        return True
    width_change = abs(float(previous.get("width", 0)) - float(geometry.get("width", 0)))
    horizontal = width_change / 2 + STABLE_TOLERANCE_PX
    for candidate in _quoted_blocks(previous, excerpt, value, cells):
        left, top, width, height = (float(item) for item in candidate)
        if (
            abs(left - box[0]) <= horizontal
            and abs(top - box[1]) <= STABLE_TOLERANCE_PX
            and abs(width - box[2]) <= STABLE_TOLERANCE_PX
            and abs(height - box[3]) <= STABLE_TOLERANCE_PX
        ):
            return True
    return False


def _source_text(data: dict[str, Any]) -> str:
    raw = str(data.get("rawHtml") or "")
    return f"{data.get('markdown') or ''}\n{html.unescape(re.sub(r'<[^>]+>', ' ', raw))}"


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class EvidenceArchive:
    def __init__(self, root: str, workspace: Any = None) -> None:
        self.root = root.rstrip("/")
        self.workspace = workspace
        if workspace is not None and not re.fullmatch(r"/Volumes/[^/]+/[^/]+/[^/]+", self.root):
            raise ValueError("Evidence root must identify a Unity Catalog Volume")

    def write(self, relative: str, content: bytes) -> str:
        parts = Path(relative).parts
        if not parts or any(part in {"..", "."} for part in parts) or Path(relative).is_absolute():
            raise ValueError("Invalid evidence archive path")
        destination = f"{self.root}/{relative}"
        if self.workspace is not None:
            self.workspace.files.create_directory(str(Path(destination).parent))
            self.workspace.files.upload(destination, io.BytesIO(content), overwrite=False)
        else:
            target = Path(destination)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                output.write(content)
        return destination


@dataclass
class PageCapture:
    url: str
    capture_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    final_url: str | None = None
    captured_at: datetime | None = None
    screenshot_path: str | None = None
    text_path: str | None = None
    coordinates_path: str | None = None
    screenshot_sha256: str | None = None
    screenshot: bytes | None = None
    geometry: dict[str, Any] | None = None
    # Text map taken just before the screenshot; the crop is only trusted where both maps agree.
    previous_geometry: dict[str, Any] | None = None
    status: str = "FAILED"
    error: str | None = None
    tool_payload: str = ""
    # Readable text of the source (markdown + HTML text), used to decide whether a value is on the page at all.
    source_text: str = ""
    # Credits Firecrawl reported for this page (full capture plus focused capture).
    credits: int = 0


@dataclass
class FocusShot:
    """One value of a focused capture: what reveal.js did, the two text maps and the viewport screenshot."""

    reveal: dict[str, Any]
    before: dict[str, Any]
    after: dict[str, Any]
    screenshot: bytes | None = None
    path: str | None = None
    coordinates_path: str | None = None
    problem: str | None = None
    # The focused page did not load the same content (blocked, changed): not proof that the value is invisible.
    unavailable: bool = False


class CaptureCollector:
    def __init__(
        self,
        api_key: str,
        archive: EvidenceArchive,
        run_id: str,
        max_credits: int | None = None,
        http_client: httpx.AsyncClient | None = None,
        concurrency: int | None = None,
        location: dict[str, Any] | None = None,
    ) -> None:
        if max_credits is not None and max_credits < 1:
            raise ValueError("Credit budget must be positive")
        # Every Firecrawl request of the run (scrapes here, searches through the MCP client) shares these slots: the
        # plan caps simultaneous requests (2 on the free plan) and answers 429 above it.
        self.slots = asyncio.Semaphore(max(1, concurrency)) if concurrency else None
        self.retry_wait = wait_exponential(multiplier=2, min=2, max=30)
        self.api_key = api_key
        self.archive = archive
        self.run_id = run_id
        self.max_credits = max_credits
        self.attempts = 0
        self.reported_credits = 0
        self.pages: dict[str, PageCapture] = {}
        self._tasks: dict[str, asyncio.Task[PageCapture]] = {}
        self._http = http_client
        self._owns_http = http_client is None
        # Firecrawl scrape location ({"country": "BR", "languages": ["pt-BR"]}) of the market, when one is configured:
        # sites then serve the localized page (language, currency, regional catalog).
        self.location = location

    async def __aenter__(self) -> Self:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=180, follow_redirects=False)
        return self

    async def __aexit__(self, *_args: object) -> None:
        if self._owns_http and self._http is not None:
            await self._http.aclose()

    async def remaining_credits(self) -> int:
        if self._http is None:
            raise RuntimeError("CaptureCollector must be used as an async context manager")
        response = await self._http.get(
            "https://api.firecrawl.dev/v2/team/credit-usage",
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        response.raise_for_status()
        document = response.json()
        remaining = (document.get("data") or {}).get("remainingCredits")
        if (
            not document.get("success")
            or isinstance(remaining, bool)
            or not isinstance(remaining, (int, float))
            or not math.isfinite(remaining)
            or remaining < 0
        ):
            raise ValueError("Firecrawl did not return a valid credit balance")
        return math.floor(remaining)

    def credits_for(self, urls: list[str]) -> int:
        """Scrape credits Firecrawl reported for these pages (full and focused captures)."""
        canonical = {canonicalize_url(str(url)) for url in urls}
        return sum(page.credits for url, page in self.pages.items() if url in canonical)

    async def scrape(self, arguments: dict[str, Any]) -> str:
        url = canonicalize_url(str(arguments.get("url", "")))
        if url is None:
            return json.dumps({"is_error": True, "content": [{"type": "text", "text": "Invalid source URL"}]})
        options = {name: value for name, value in arguments.items() if name not in {"url", "formats"}}
        request_key = json.dumps({"url": url, "options": options}, sort_keys=True)
        if request_key not in self._tasks:
            self._tasks[request_key] = asyncio.create_task(self._capture(url, arguments))
        page = await asyncio.shield(self._tasks[request_key])
        self.pages[url] = page
        return page.tool_payload

    async def _capture(self, url: str, arguments: dict[str, Any]) -> PageCapture:
        page = PageCapture(url=url)
        payload: dict[str, Any] = {"url": url, "formats": ["markdown", "rawHtml"], "maxAge": 0}
        for name in (
            "onlyMainContent",
            "includeTags",
            "excludeTags",
            "waitFor",
            "timeout",
            "mobile",
            "location",
            "removeBase64Images",
        ):
            if name in arguments:
                payload[name] = arguments[name]
        if self.location and "location" not in payload:
            payload["location"] = self.location
        is_pdf = urlsplit(url).path.casefold().endswith(".pdf")
        if self.max_credits is not None and is_pdf:
            page.status = "UNSUPPORTED"
            page.error = "PDF excluded from the credit-limited recapture; no paid request was made."
            page.tool_payload = self._error_payload(page.error)
            return page
        original_actions: list[dict[str, Any]] = []
        if not is_pdf:
            requested = arguments.get("actions", []) if self.max_credits is None else []
            original_actions = (
                [item for item in requested if isinstance(item, dict)] if isinstance(requested, list) else []
            )
            payload["actions"] = [
                *original_actions,
                {"type": "wait", "milliseconds": 1000},
                # Refuse the cookie banner, open what a visitor can open (accordions, <details>, "show more"), then
                # scroll to the end and back so lazy-loaded content is rendered before the text maps and the screenshot.
                {"type": "executeJavascript", "script": DISMISS_SCRIPT},
                {"type": "wait", "milliseconds": 500},
                {"type": "executeJavascript", "script": EXPAND_SCRIPT},
                {"type": "executeJavascript", "script": SCROLL_BOTTOM_SCRIPT},
                {"type": "wait", "milliseconds": 1500},
                {"type": "executeJavascript", "script": SCROLL_TOP_SCRIPT},
                {"type": "wait", "milliseconds": 500},
                {"type": "executeJavascript", "script": DOM_SCRIPT},
                {"type": "screenshot", "fullPage": True, "quality": 100},
                {"type": "executeJavascript", "script": DOM_SCRIPT},
            ]
        if self._budget_exhausted():
            page.error = "Recapture credit budget exhausted; no paid request was made."
            page.tool_payload = self._error_payload(page.error)
            return page
        if self.max_credits is not None:
            payload["parsers"] = []
        try:
            data = await self._post_scrape(payload, page)
            metadata = data.get("metadata") or {}
            page.source_text = _source_text(data)
            page.final_url = metadata.get("url") or metadata.get("sourceURL") or url
            page.captured_at = datetime.now(timezone.utc)
            directory = f"{self.run_id}/{page.capture_id}"
            public_data = {key: data[key] for key in ("markdown", "metadata", "links", "images") if key in data}
            page.tool_payload = json.dumps(
                {"is_error": False, "content": [{"type": "text", "text": json.dumps(public_data, ensure_ascii=False)}]},
                ensure_ascii=False,
            )
            page.text_path = await asyncio.to_thread(
                self.archive.write,
                f"{directory}/source.json",
                json.dumps(data, ensure_ascii=False).encode(),
            )
            status_code = metadata.get("statusCode")
            if isinstance(status_code, int) and status_code >= 400:
                # an error page (archived above for the audit) is not a source; the agent does not cite it either
                page.error = f"The page answered HTTP {status_code}."
                return page
            if is_pdf or "pdf" in str(metadata.get("contentType", "")).casefold():
                page.status = "UNSUPPORTED"
                page.error = "Text extracted from PDF; visual capture is unavailable."
                return page
            actions = data.get("actions") or {}
            screenshots = actions.get("screenshots") or []
            screenshot_url = screenshots[-1] if screenshots else data.get("screenshot")
            page.screenshot, page.screenshot_path = await self._store_screenshot(screenshot_url, f"{directory}/page")
            page.screenshot_sha256 = _digest(page.screenshot)
            page.status = "SCREENSHOT_ONLY"
            returns = actions.get("javascriptReturns") or []
            maps = [self._geometry(item) for item in returns[-2:]]
            if len(maps) != 2 or not maps[1].get("blocks"):
                raise ValueError("Missing rendered text coordinates")
            # The map taken after the screenshot describes the captured layout (the engine may stretch the document
            # height and add a scrollbar while capturing). Stability is checked later, only for the cropped block.
            if maps[0].get("viewportWidth") != maps[1].get("viewportWidth"):
                raise ValueError("The viewport changed during the capture")
            # The cookie and expansion scripts run right after the research actions; their href is the page address.
            expansion = sum(1 for item in original_actions if item.get("type") == "executeJavascript")
            start = self._geometry(returns[expansion]) if len(returns) > expansion else maps[0]
            if any(item.get("href") != start.get("href") for item in maps):
                raise ValueError("The page changed address during the capture")
            page.previous_geometry = maps[0]
            page.geometry = maps[1]
            page.coordinates_path = await asyncio.to_thread(
                self.archive.write,
                f"{directory}/coordinates.json",
                json.dumps(page.geometry, ensure_ascii=False).encode(),
            )
            page.status = "CAPTURED"
        except (httpx.HTTPError, DatabricksError, OSError, ValueError, KeyError, TypeError) as exc:
            page.error = safe_exception_message(exc, self.api_key)
            if not page.tool_payload:
                page.tool_payload = self._error_payload(page.error)
        return page

    def _budget_exhausted(self) -> bool:
        return self.max_credits is not None and max(self.attempts, self.reported_credits) >= self.max_credits

    async def _post_scrape(self, payload: dict[str, Any], page: PageCapture | None = None) -> dict[str, Any]:
        """One paid Firecrawl scrape; the attempt is counted before the request so a failure still uses the budget.

        A 429 (too many simultaneous requests for the plan) is not charged and is retried with exponential backoff.
        """
        self.attempts += 1
        if self._http is None:
            raise RuntimeError("CaptureCollector must be used as an async context manager")
        http = self._http
        async for attempt in AsyncRetrying(
            retry=retry_if_exception(
                lambda exc: isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429
            ),
            wait=self.retry_wait,
            stop=stop_after_attempt(4),
            reraise=True,
        ):
            with attempt:
                async with self.slots or _NO_LIMIT:
                    response = await http.post(
                        "https://api.firecrawl.dev/v2/scrape",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                    )
                response.raise_for_status()
        document = response.json()
        if not document.get("success") or not isinstance(document.get("data"), dict):
            raise ValueError("Firecrawl extraction did not succeed")
        data = document["data"]
        charged = (data.get("metadata") or {}).get("creditsUsed")
        if isinstance(charged, (int, float)) and charged >= 0:
            self.reported_credits += math.ceil(charged)
            if page is not None:
                page.credits += math.ceil(charged)
        return data

    async def _store_screenshot(self, screenshot_url: Any, stem: str) -> tuple[bytes, str]:
        if not isinstance(screenshot_url, str) or urlsplit(screenshot_url).scheme != "https":
            raise ValueError("Firecrawl did not return an HTTPS screenshot URL")
        content = await self._download(screenshot_url)
        with Image.open(io.BytesIO(content)) as image:
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("Screenshot exceeds the image size limit")
            image.verify()
            extension = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}.get(image.format)
        if extension is None:
            raise ValueError("Unsupported screenshot encoding")
        path = await asyncio.to_thread(self.archive.write, f"{stem}.{extension}", content)
        return content, path

    @staticmethod
    def _error_payload(message: str) -> str:
        return json.dumps({"is_error": True, "content": [{"type": "text", "text": message}]})

    @staticmethod
    def _geometry(item: Any) -> dict[str, Any]:
        value = item.get("value") if isinstance(item, dict) else item
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, dict):
            raise TypeError("Invalid rendered text map")
        return value

    async def _download(self, url: str) -> bytes:
        if self._http is None:
            raise RuntimeError("HTTP client is unavailable")
        async with self._http.stream("GET", url) as response:
            response.raise_for_status()
            parts: list[bytes] = []
            total = 0
            async for part in response.aiter_bytes():
                total += len(part)
                if total > MAX_IMAGE_BYTES:
                    raise ValueError("Screenshot exceeds the download size limit")
                parts.append(part)
            return b"".join(parts)

    def crop(self, evidence: VisualEvidence, value: str) -> VisualEvidence:
        page = self.pages.get(canonicalize_url(evidence.url) or "")
        if page is None:
            evidence.capture_status = "NOT_CAPTURED"
            evidence.capture_error = "No visual capture was recorded for this source."
            return evidence
        for name in (
            "capture_id",
            "final_url",
            "captured_at",
            "screenshot_path",
            "text_path",
            "coordinates_path",
            "screenshot_sha256",
        ):
            setattr(evidence, name, getattr(page, name))
        evidence.capture_status = page.status
        evidence.capture_error = page.error
        if page.status != "CAPTURED" or page.screenshot is None or page.geometry is None:
            return evidence
        return self._crop_image(
            evidence,
            value,
            page.screenshot,
            page.geometry,
            page.previous_geometry,
            f"{self.run_id}/{page.capture_id}/crops",
        )

    def _crop_image(
        self,
        evidence: VisualEvidence,
        value: str,
        screenshot: bytes,
        geometry: dict[str, Any],
        previous: dict[str, Any] | None,
        crop_directory: str,
        viewport: bool = False,
    ) -> VisualEvidence:
        """Crop the unique visible block with the value; ``viewport`` crops a screenshot of the visible window only."""
        # The model quotes the markdown of the page; the match is made on the visible text (the stored excerpt is kept).
        excerpt = _visible_excerpt(evidence.excerpt)
        cells = table_cells(evidence.excerpt)
        try:
            if "blocks" not in geometry:
                raise KeyError("blocks")
            boxes = _quoted_blocks(geometry, excerpt, value, cells)
            if len(boxes) != 1:
                evidence.capture_status = "AMBIGUOUS" if boxes else "NO_MATCH"
                evidence.capture_error = "A unique visible excerpt containing the explicit value was not found."
                return evidence
            moved = (
                viewport
                and previous is not None
                and any(
                    abs(float(previous.get(axis, 0)) - float(geometry.get(axis, 0))) > STABLE_TOLERANCE_PX
                    for axis in ("scrollX", "scrollY")
                )
            )
            if moved or not _stable(next(iter(boxes)), geometry, previous, excerpt, value, cells):
                evidence.capture_status = "SCREENSHOT_ONLY"
                evidence.capture_error = "The excerpt moved while the page was captured; check the full screenshot."
                return evidence
            with Image.open(io.BytesIO(screenshot)) as image:
                if viewport:
                    # A viewport screenshot shows the window at the scroll position of the text map.
                    width, height = geometry["viewportWidth"], geometry["viewportHeight"]
                    offset_x, offset_y = float(geometry["scrollX"]), float(geometry["scrollY"])
                else:
                    width = max(geometry["width"], geometry.get("viewportWidth", 0))
                    height = geometry["height"]
                    offset_x = offset_y = 0.0
                if width <= 0 or height <= 0:
                    raise ValueError("Screenshot dimensions do not match the rendered document")
                scale = image.width / width
                if abs(image.height - height * scale) > 1:
                    raise ValueError("Screenshot dimensions do not match the rendered document")
                left, top, box_width, box_height = next(iter(boxes))
                left, top = left - offset_x, top - offset_y
                if not all(math.isfinite(item) for item in (left, top, box_width, box_height)):
                    raise ValueError("Invalid crop coordinates")
                if left < 0 or top < 0 or box_width <= 0 or box_height <= 0:
                    raise ValueError("Visible excerpt is outside the screenshot")
                if left + box_width > width + 1 or top + box_height > height + 1:
                    raise ValueError("Screenshot does not contain the complete excerpt")
                padding = 12 * scale
                crop_box = [
                    max(0, math.floor(left * scale - padding)),
                    max(0, math.floor(top * scale - padding)),
                    min(image.width, math.ceil((left + box_width) * scale + padding)),
                    min(image.height, math.ceil((top + box_height) * scale + padding)),
                ]
                buffer = io.BytesIO()
                image.crop(tuple(crop_box)).save(buffer, format="PNG")
            content = buffer.getvalue()
            evidence.crop_path = self.archive.write(f"{crop_directory}/{evidence.evidence_id}.png", content)
            evidence.crop_box = crop_box
            evidence.crop_sha256 = _digest(content)
            evidence.capture_status = "COMPLETE"
            evidence.capture_error = None
        except (DatabricksError, OSError, ValueError, KeyError, TypeError, OverflowError) as exc:
            evidence.capture_status = "FAILED"
            evidence.capture_error = safe_exception_message(exc, self.api_key)
        return evidence

    def attach(self, result: ProductEnrichment) -> list[ValidationIssue]:
        """Crop every attribute value from the full-page captures; run ``focus`` afterwards for what is left."""
        for attribute in result.attributes:
            attribute.visual_evidence = []
            if not attribute.applicable or not (attribute.value or attribute.candidate_value):
                continue
            # The evidence policy keeps in source_fact_names only the facts that state the candidate (same value up to
            # spelling, unit or market equivalence).
            facts = [fact for fact in result.facts if fact.name in attribute.source_fact_names]
            candidate = attribute.candidate_value or attribute.value or ""
            for url in attribute.evidence_urls:
                canonical = canonicalize_url(str(url))
                matches = [
                    (fact, evidence)
                    for fact in facts
                    for evidence in fact.evidence
                    if canonicalize_url(str(evidence.url)) == canonical
                ]
                if not matches:
                    # No fact quotes this exact value: look for a single visible block with the explicit value on the
                    # page, and keep the page screenshot as evidence when there is none (status NO_MATCH).
                    reference = VisualEvidence(
                        evidence_id=str(uuid.uuid4()),
                        url=str(url),
                        capture_status="NOT_CAPTURED",
                    )
                    attribute.visual_evidence.append(self.crop(reference, candidate))
                for fact, source in matches:
                    reference = VisualEvidence(
                        evidence_id=str(uuid.uuid4()),
                        url=str(source.url),
                        source_title=source.source_title,
                        source_tier=source.source_tier.value,
                        fact_name=fact.name,
                        fact_value=fact.value,
                        excerpt=source.excerpt,
                        capture_status="NOT_CAPTURED",
                    )
                    value = crop_value(source.excerpt, fact.value, fact.normalized_value, candidate)
                    attribute.visual_evidence.append(self.crop(reference, value))
                    if reference.captured_at is not None:
                        source.retrieved_at = reference.captured_at
        return visual_issues(result)

    async def focus(self, result: ProductEnrichment) -> None:
        """Second capture for values that are on the page but were not cropped from the full-page screenshot.

        For each such value, the page's own control is clicked when the value sits in a collapsed section or tab
        (reveal.js), the value is centered and a screenshot of the visible window is taken between two text maps.
        The window is not resized, so the text map and the image describe the same layout. One paid scrape per page
        covers all of its values. A value that still cannot be shown gets NOT_VISIBLE with the reason.
        """
        pending: dict[str, list[tuple[VisualEvidence, str]]] = {}
        for attribute in result.attributes:
            for evidence in attribute.visual_evidence:
                if evidence.capture_status not in FOCUS_STATUSES:
                    continue
                url = canonicalize_url(evidence.url) or ""
                page = self.pages.get(url)
                value = crop_value(
                    evidence.excerpt, evidence.fact_value, attribute.candidate_value, attribute.value
                ) or (attribute.candidate_value or attribute.value or "")
                if page is None or page.status != "CAPTURED" or not _contains(page.source_text, value):
                    continue  # not on the page at all: no paid request (the full screenshot stays as evidence)
                pending.setdefault(url, []).append((evidence, value))
        if self.max_credits is not None:
            # credit-limited recapture: one page at a time so the budget is checked before every paid request
            for url, items in pending.items():
                await self._focus_page(self.pages[url], items)
            return
        await asyncio.gather(*(self._focus_page(self.pages[url], items) for url, items in pending.items()))

    async def _focus_page(self, page: PageCapture, items: list[tuple[VisualEvidence, str]]) -> None:
        targets: list[dict[str, Any]] = []
        assigned: list[tuple[VisualEvidence, str, int | None]] = []
        for evidence, value in items:
            needle = _visible_excerpt(evidence.excerpt).strip()
            if needle and not _contains(page.source_text, needle):
                needle = ""  # an excerpt that is not literally on the page cannot locate the element
            key = {"needle": needle, "value": value}
            index = next((item["index"] for item in targets if {k: item[k] for k in key} == key), None)
            if index is None and len(targets) < MAX_FOCUS_TARGETS:
                index = len(targets)
                targets.append({"index": index, **key})
            assigned.append((evidence, value, index))
        if not targets:
            return
        if self._budget_exhausted():
            for evidence, _value, _index in assigned:
                self._not_visible(evidence, "Recapture credit budget exhausted before the focused capture.")
            return
        actions: list[dict[str, Any]] = [
            {"type": "wait", "milliseconds": 1000},
            {"type": "executeJavascript", "script": DISMISS_SCRIPT},
            {"type": "wait", "milliseconds": 500},
        ]
        for target in targets:
            actions += [
                {"type": "executeJavascript", "script": _script("reveal", target)},
                {"type": "wait", "milliseconds": 700},
                {"type": "executeJavascript", "script": _script("scroll", target["index"])},
                {"type": "wait", "milliseconds": 300},
                {"type": "executeJavascript", "script": DOM_SCRIPT},
                {"type": "screenshot", "fullPage": False, "quality": 100},
                {"type": "executeJavascript", "script": DOM_SCRIPT},
            ]
        payload: dict[str, Any] = {"url": page.url, "formats": ["markdown"], "maxAge": 0, "actions": actions}
        if self.max_credits is not None:
            payload["parsers"] = []
        capture_id = str(uuid.uuid4())
        directory = f"{self.run_id}/{capture_id}"
        try:
            data = await self._post_scrape(payload, page)
            returns = (data.get("actions") or {}).get("javascriptReturns") or []
            screenshots = (data.get("actions") or {}).get("screenshots") or []
            returns = returns[1:]  # the first return is the cookie banner refusal
            if len(returns) != 4 * len(targets) or len(screenshots) != len(targets):
                raise ValueError("Firecrawl did not return every focused capture")
        except (httpx.HTTPError, DatabricksError, OSError, ValueError, KeyError, TypeError) as exc:
            reason = f"Focused capture failed: {safe_exception_message(exc, self.api_key)}"
            for evidence, _value, _index in assigned:
                evidence.capture_error = reason
            return
        captured_at = datetime.now(timezone.utc)
        focused_text = _source_text(data)
        shots: dict[int, FocusShot] = {}
        for target in targets:
            index = target["index"]
            try:
                reveal, _scroll, before, after = (self._geometry(item) for item in returns[4 * index : 4 * index + 4])
            except (ValueError, TypeError):
                shots[index] = FocusShot(reveal={}, before={}, after={}, problem="Invalid focused text map.")
                continue
            shot = FocusShot(reveal=reveal, before=before, after=after)
            shots[index] = shot
            if not reveal.get("found"):
                if not _contains(focused_text, target["value"]):
                    shot.unavailable = True
                    shot.problem = "The page did not load the same content in the focused capture (blocked or changed)."
                else:
                    shot.problem = "The value is in the page source but in no displayed element (e.g. structured data)."
                continue
            if any(item.get("href") != page.geometry.get("href") for item in (reveal, before, after)):
                shot.problem = "The page changed address while the section was opened."
                continue
            try:
                shot.screenshot, shot.path = await self._store_screenshot(
                    screenshots[index], f"{directory}/focus-{index}"
                )
                coordinates = {**after, "previous": before, "revealedBy": reveal.get("revealedBy", [])}
                shot.coordinates_path = await asyncio.to_thread(
                    self.archive.write,
                    f"{directory}/focus-{index}.json",
                    json.dumps(coordinates, ensure_ascii=False).encode(),
                )
            except (httpx.HTTPError, DatabricksError, OSError, ValueError) as exc:
                shot.screenshot = None
                shot.problem = f"Focused screenshot failed: {safe_exception_message(exc, self.api_key)}"
        for evidence, value, index in assigned:
            if index is None:
                evidence.capture_error = "Too many values on this page for one focused capture; check the screenshot."
                continue
            shot = shots[index]
            if shot.unavailable:
                evidence.capture_error = f"Focused capture: {shot.problem}"
                continue
            if shot.problem is not None or shot.screenshot is None:
                self._not_visible(evidence, shot.problem or "Focused screenshot is unavailable.")
                continue
            attempt = evidence.model_copy(update={"crop_path": None, "crop_box": None, "crop_sha256": None})
            self._crop_image(
                attempt, value, shot.screenshot, shot.after, shot.before, f"{directory}/crops", viewport=True
            )
            if attempt.capture_status == "COMPLETE":
                evidence.capture_id = capture_id
                evidence.captured_at = captured_at
                evidence.screenshot_path = shot.path
                evidence.screenshot_sha256 = _digest(shot.screenshot)
                evidence.coordinates_path = shot.coordinates_path
                evidence.crop_path = attempt.crop_path
                evidence.crop_box = attempt.crop_box
                evidence.crop_sha256 = attempt.crop_sha256
                evidence.capture_status, evidence.capture_error = "COMPLETE", None
            elif attempt.capture_status == "NO_MATCH":
                how = ", ".join(shot.reveal.get("revealedBy") or []) or "no page control"
                self._not_visible(evidence, f"The value stayed hidden or covered after opening the section ({how}).")
            else:
                evidence.capture_error = f"Focused capture: {attempt.capture_error}"

    @staticmethod
    def _not_visible(evidence: VisualEvidence, reason: str) -> None:
        evidence.capture_status = "NOT_VISIBLE"
        evidence.capture_error = reason


def visual_issues(result: ProductEnrichment) -> list[ValidationIssue]:
    return [
        make(
            "VISUAL_EVIDENCE_INCOMPLETE",
            Severity.ERROR,
            f"attributes.{attribute.code}",
            attribute=attribute.name or attribute.code,
        )
        for attribute in result.attributes
        if attribute.value and not any(item.capture_status == "COMPLETE" for item in attribute.visual_evidence)
    ]


def evidence_rows(
    result: ProductEnrichment,
    run_id: str,
    capture_mode: str = "ENRICHMENT",
    source_run_id: str | None = None,
) -> list[dict[str, Any]]:
    rows = []
    for attribute in result.attributes:
        for evidence in attribute.visual_evidence:
            row = evidence.model_dump(exclude={"crop_box"})
            if row["captured_at"] is not None:
                row["captured_at"] = row["captured_at"].astimezone(timezone.utc).replace(tzinfo=None)
            row.update(
                run_id=run_id,
                source_run_id=source_run_id,
                capture_mode=capture_mode,
                ean=result.ean,
                attribute_code=attribute.code,
                attribute_name=attribute.name,
                attribute_value=attribute.value,
                candidate_value=attribute.candidate_value,
                crop_box_json=json.dumps(evidence.crop_box),
            )
            rows.append(row)
    return rows
