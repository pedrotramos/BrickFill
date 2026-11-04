"""Notices beyond the cookie banner (capture_scripts/overlays.js, behind the dismiss_overlays flag).

The action assembly is tested always. The script itself runs on the synthetic pages of tests/fixtures/overlays in a
headless Chrome, at window heights 1080 and 100000 (Firecrawl's tall window), when Chrome is installed and
``BRICKFILL_BROWSER_TESTS=1``: it must answer each notice as listed and never hide the page.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import httpx
import pytest

from brickfill.models import VisualEvidence
from brickfill.visual_evidence import (
    CAPTURE_SCRIPTS,
    FIRECRAWL_MAX_ACTIONS,
    OVERLAYS_SCRIPT,
    CaptureCollector,
    EvidenceArchive,
)

FIXTURES = Path(__file__).parent / "fixtures" / "overlays"
CHROME = next(
    (
        path
        for path in (
            os.environ.get("CHROME_BINARY", ""),
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            shutil.which("google-chrome") or "",
            shutil.which("chromium") or "",
        )
        if path and Path(path).exists()
    ),
    None,
)


def scraped_actions(tmp_path: Path, dismiss_overlays: bool, monkeypatch, requested: list | None = None) -> list[dict]:
    sent: list[dict] = []

    async def no_dns(host, port):
        raise OSError("no network in tests")

    # the failed scrape is tried as a direct PDF: keep that off the network
    monkeypatch.setattr("brickfill.pdf_evidence._resolve", no_dns)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            sent.append(json.loads(request.content))
        return httpx.Response(500)

    async def go():
        async with (
            httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http,
            CaptureCollector(
                "key", EvidenceArchive(str(tmp_path)), "run", http_client=http, dismiss_overlays=dismiss_overlays
            ) as collector,
        ):
            await collector.scrape({"url": "https://shop.example.com/p/1", "actions": requested or []})

    asyncio.run(go())
    return sent[0]["actions"]


def test_flag_off_keeps_the_capture_actions_unchanged(tmp_path, monkeypatch):
    actions = scraped_actions(tmp_path, False, monkeypatch)
    assert not any(item.get("script") == OVERLAYS_SCRIPT for item in actions)
    assert [item["type"] for item in actions[:3]] == ["wait", "executeJavascript", "wait"]


def test_flag_on_answers_the_notices_three_times_after_the_cookie_banner(tmp_path, monkeypatch):
    actions = scraped_actions(tmp_path, True, monkeypatch)
    scripts = [item.get("script") for item in actions if item["type"] == "executeJavascript"]
    assert scripts[1:4] == [OVERLAYS_SCRIPT] * 3
    # the text maps stay the last two script returns, so the capture reads them as before
    assert actions[-1]["type"] == actions[-3]["type"] == "executeJavascript" and actions[-2]["type"] == "screenshot"


@pytest.mark.parametrize("dismiss_overlays", [False, True])
def test_full_page_scrape_stays_within_firecrawl_action_limit(tmp_path, monkeypatch, dismiss_overlays):
    requested = [{"type": "click", "selector": f"#tab-{index}"} for index in range(60)]
    actions = scraped_actions(tmp_path, dismiss_overlays, monkeypatch, requested)
    assert len(actions) == FIRECRAWL_MAX_ACTIONS
    assert actions[0] == requested[0]  # the agent's actions still run first


@pytest.mark.parametrize(("dismiss_overlays", "shown"), [(False, 6), (True, 5)])
def test_focused_scrape_stays_within_firecrawl_action_limit(tmp_path, monkeypatch, dismiss_overlays, shown):
    from test_capture import PAGE_URL, capture, firecrawl, png, text_map

    geometry = text_map([277, 267, 1366, 72])
    collector = capture(tmp_path, firecrawl(png(1920, 2499), [geometry, geometry]))
    collector.dismiss_overlays = dismiss_overlays
    page = collector.pages[PAGE_URL]
    page.source_text = " ".join(f"Value {index} W" for index in range(8))
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(500)

    items = [
        (
            VisualEvidence(
                evidence_id=f"ev-{index}", url=PAGE_URL, excerpt=f"Value {index} W", capture_status="NO_MATCH"
            ),
            f"{index} W",
        )
        for index in range(8)
    ]

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            collector._http = http
            await collector._focus_page(page, items)

    asyncio.run(go())
    assert len(sent[0]["actions"]) <= FIRECRAWL_MAX_ACTIONS
    assert sum(item["type"] == "screenshot" for item in sent[0]["actions"]) == shown


EXPECTED = {
    "cookie-with-buttons": [["click", "Rejeitar todos"]],
    "cookie-without-button": [["hide", "Este site usa cookies. Saiba mais na nossa política de privacidade."]],
    "region-continue": [["click", "Continuar"]],
    "tutorial-confirm": [["click", "Pular"], ["click", "Sim, pular"]],
    "body-candidate": [["click", "Não, obrigado"]],
}


def _run_in_chrome(page: Path, height: int, tmp_path: Path) -> dict:
    source = (CAPTURE_SCRIPTS / "overlays.js").read_text(encoding="utf-8")
    run = "\n".join(line for line in source.splitlines() if not line.startswith("//")).strip()
    probe = f"""<script>window.addEventListener('load', () => setTimeout(async () => {{
  const run = {run};
  const passes = [];
  for (let i = 0; i < 3; i++) {{ passes.push(JSON.parse(run()).actions); await new Promise(r => setTimeout(r, 300)); }}
  const shown = el => {{ for (let e = el; e; e = e.parentElement) {{ const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none') return false; }} return true; }};
  const pre = document.createElement('pre'); pre.id = 'overlay-result';
  pre.textContent = JSON.stringify({{ passes, body: getComputedStyle(document.body).visibility,
    main: shown(document.querySelector('main')) }});
  document.documentElement.appendChild(pre);
}}, 200));</script></body>"""
    target = tmp_path / f"{page.stem}-{height}.html"
    target.write_text(page.read_text(encoding="utf-8").replace("</body>", probe), encoding="utf-8")
    profile = tmp_path / f"profile-{page.stem}-{height}"
    dom = subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            f"--user-data-dir={profile}",
            f"--window-size=1920,{height}",
            "--virtual-time-budget=8000",
            "--dump-dom",
            target.as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    ).stdout
    match = re.search(r'<pre id="overlay-result">(.*?)</pre>', dom, re.DOTALL)
    assert match, f"no result from {page.name}"
    return json.loads(html.unescape(match.group(1)))


@pytest.mark.skipif(
    CHROME is None or os.environ.get("BRICKFILL_BROWSER_TESTS") != "1",
    reason="needs Chrome and BRICKFILL_BROWSER_TESTS=1",
)
@pytest.mark.parametrize("height", [1080, 100_000])
@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_overlays_on_synthetic_pages(name, height, tmp_path):
    result = _run_in_chrome(FIXTURES / f"{name}.html", height, tmp_path)
    assert result["body"] == "visible" and result["main"] is True
    done = [[action["kind"], action["label"]] for actions in result["passes"] for action in actions]
    # pages without handlers keep their notice, so a pass may answer it again: only the first answers count
    assert list(dict.fromkeys(map(tuple, done))) == [tuple(item) for item in EXPECTED[name]]
