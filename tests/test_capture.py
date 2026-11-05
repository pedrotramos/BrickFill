"""Full-page capture and crop with synthetic Firecrawl answers (httpx.MockTransport; no network, no credits)."""

from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path

import httpx
from PIL import Image, ImageDraw

from brickfill.models import VisualEvidence
from brickfill.visual_evidence import (
    CaptureCollector,
    EvidenceArchive,
    _same_capture_page,
    _single_color,
    crop_screenshot,
)

PAGE_URL = "https://shop.example.com/product/x100"
SCREENSHOT_URL = "https://cdn.example.com/screenshot.png"
TALL = 100_000  # Firecrawl's rendering window height


def png(width: int, height: int, *, blank: bool = False) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    if not blank:
        draw = ImageDraw.Draw(image)
        for top in range(40, height - 40, 60):
            draw.rectangle((100, top, min(width - 100, 900), top + 20), fill=(30, 30, 30))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def text_map(box: list[float], *, href: str = PAGE_URL, width: int = 1920, height: int = TALL) -> dict:
    """What dom_map.js reports in Firecrawl's 1920x100000 window: the document is at least as tall as the window."""
    context = "Power: 750 W"
    return {
        "href": href,
        "width": width,
        "height": height,
        "viewportWidth": width,
        "viewportHeight": TALL,
        "scrollX": 0,
        "scrollY": 0,
        "blocks": [{"text": context, "context": context, "box": box}],
    }


def evidence(excerpt: str = "Power: 750 W") -> VisualEvidence:
    return VisualEvidence(evidence_id="ev-1", url=PAGE_URL, excerpt=excerpt, capture_status="NOT_CAPTURED")


def crop(tmp_path: Path, image: bytes, geometry: dict) -> VisualEvidence:
    archive = EvidenceArchive(str(tmp_path))
    return crop_screenshot(archive, evidence(), "750 W", image, geometry, None, "run/capture/crops")


def test_tall_window_crop_uses_the_part_of_the_layout_the_image_shows(tmp_path):
    result = crop(tmp_path, png(1920, 2499), text_map([277, 267, 1366, 72]))
    assert result.capture_status == "COMPLETE", result.capture_error
    left, top, right, bottom = result.crop_box
    assert (left, top, right, bottom) == (265, 255, 1655, 351)
    assert bottom - top == 96  # 72 px block + 12 px padding above and below
    with Image.open(Path(result.crop_path)) as cropped:
        assert cropped.size == (1390, 96)


def test_block_below_the_end_of_the_image_is_not_cropped(tmp_path):
    result = crop(tmp_path, png(1920, 2499), text_map([277, 2480, 1366, 72]))
    assert result.capture_status == "FAILED"
    assert result.capture_error == "ValueError: Screenshot does not contain the complete excerpt"
    assert result.crop_path is None


def test_double_width_image_scales_the_crop(tmp_path):
    result = crop(tmp_path, png(3840, 4998), text_map([277, 267, 1366, 72]))
    assert result.capture_status == "COMPLETE", result.capture_error
    assert result.crop_box == [530, 510, 3310, 702]


def test_image_with_no_width_fails(tmp_path):
    result = crop(tmp_path, png(1920, 2499), text_map([277, 267, 1366, 72], width=0) | {"viewportWidth": 0})
    assert result.capture_status == "FAILED"


def test_single_color():
    assert _single_color(png(400, 300, blank=True))
    assert not _single_color(png(400, 300))


def test_same_capture_page_ignores_query_and_fragment_only():
    assert _same_capture_page(PAGE_URL, PAGE_URL + "#specs")
    assert _same_capture_page(PAGE_URL, PAGE_URL + "/?utm=x")
    assert _same_capture_page(PAGE_URL, "https://SHOP.example.com/product/x100")
    assert not _same_capture_page(PAGE_URL, "https://shop.example.com/product/produto-b")
    assert not _same_capture_page(PAGE_URL, "http://shop.example.com/product/x100")


# --- _capture with a fake Firecrawl ---------------------------------------------------------------------------------


def firecrawl(screenshot: bytes, maps: list[dict | None]):
    """A Firecrawl that answers one scrape (6 script returns: dismiss, expand, 2 scrolls, 2 text maps)."""

    def returns() -> list[dict]:
        items = [{"type": "executeJavascript", "value": json.dumps({"href": PAGE_URL})} for _ in range(4)]
        items += [{"type": "executeJavascript", "value": json.dumps(item)} for item in maps if item is not None]
        return items

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url == SCREENSHOT_URL:
            return httpx.Response(200, content=screenshot)
        assert request.url == "https://api.firecrawl.dev/v2/scrape"
        data = {
            "markdown": "Power: 750 W",
            "metadata": {"url": PAGE_URL, "statusCode": 200, "creditsUsed": 1},
            "actions": {"screenshots": [SCREENSHOT_URL], "javascriptReturns": returns()},
        }
        return httpx.Response(200, json={"success": True, "data": data})

    return httpx.MockTransport(handler)


def capture(tmp_path: Path, transport: httpx.MockTransport):
    async def run():
        async with (
            httpx.AsyncClient(transport=transport) as http,
            CaptureCollector("fc-key", EvidenceArchive(str(tmp_path)), "run-1", http_client=http) as collector,
        ):
            await collector.scrape({"url": PAGE_URL})
            return collector

    return asyncio.run(run())


def test_capture_and_crop_in_the_tall_window(tmp_path):
    geometry = text_map([277, 267, 1366, 72], height=TALL)
    collector = capture(tmp_path, firecrawl(png(1920, 2499), [geometry, geometry]))
    page = collector.pages[PAGE_URL]
    assert page.status == "CAPTURED", page.error
    result = collector.crop(evidence(), "750 W")
    assert result.capture_status == "COMPLETE", result.capture_error


def test_page_ui_adding_a_fragment_is_the_same_page(tmp_path):
    geometry = text_map([277, 267, 1366, 72])
    moved = text_map([277, 267, 1366, 72], href=PAGE_URL + "#specs")
    page = capture(tmp_path, firecrawl(png(1920, 2499), [geometry, moved])).pages[PAGE_URL]
    assert page.status == "CAPTURED", page.error


def test_blank_screenshot_fails_and_is_not_shown_as_the_page(tmp_path):
    geometry = text_map([277, 267, 1366, 72])
    page = capture(tmp_path, firecrawl(png(1920, 2499, blank=True), [geometry, geometry])).pages[PAGE_URL]
    assert page.status == "FAILED"
    assert "blank screenshot" in page.error
    assert page.screenshot_path is None and page.screenshot is None
    # still archived in the capture's directory for the audit
    assert list(tmp_path.glob(f"run-1/{page.capture_id}/page.png"))


def test_missing_text_map_fails_instead_of_screenshot_only(tmp_path):
    page = capture(tmp_path, firecrawl(png(1920, 2499), [None, None])).pages[PAGE_URL]
    assert page.status == "FAILED"
    assert page.error == "ValueError: Missing rendered text coordinates"
    assert page.screenshot_path  # the real page screenshot stays available to the reviewer


def test_focused_capture_shoots_the_full_page_in_the_tall_window(tmp_path):
    """In the 1920x100000 window the page never scrolls; a value far below the first screen is still cropped."""
    low = text_map([277, 2400, 1366, 72])
    collector = capture(tmp_path, firecrawl(png(1920, 2499), [low, low]))
    page = collector.pages[PAGE_URL]
    sent: list[dict] = []
    focus_shot = "https://cdn.example.com/focus.png"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url == focus_shot:
            return httpx.Response(200, content=png(1920, 2499))
        sent.append(json.loads(request.content))
        reveal = {"href": PAGE_URL, "found": True, "revealedBy": []}
        returns = [{"href": PAGE_URL}, reveal, {"href": PAGE_URL}, low, low]
        data = {
            "markdown": "Power: 750 W",
            "metadata": {"url": PAGE_URL, "statusCode": 200, "creditsUsed": 1},
            "actions": {
                "screenshots": [focus_shot],
                "javascriptReturns": [{"type": "executeJavascript", "value": json.dumps(item)} for item in returns],
            },
        }
        return httpx.Response(200, json={"success": True, "data": data})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            collector._http = http
            item = evidence()
            await collector._focus_page(page, [(item, "750 W")])
            return item

    item = asyncio.run(go())
    shots = [action for action in sent[0]["actions"] if action["type"] == "screenshot"]
    assert shots == [{"type": "screenshot", "fullPage": True, "quality": 100}]
    assert item.capture_status == "COMPLETE", item.capture_error
