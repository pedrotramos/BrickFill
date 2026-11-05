"""One reference capture per attribute: ranking by reputation, fallback, lots, reserves and budget (no network)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
from tenacity import wait_none
from test_capture import png

from brickfill.models import CatalogAttribute, ProductEnrichment, VisualEvidence
from brickfill.visual_evidence import (
    EVIDENCE_ADDED_COLUMNS,
    EVIDENCE_COLUMNS,
    CaptureCollector,
    EvidenceArchive,
    FirecrawlError,
    PageCapture,
    evidence_rows,
    rank_references,
    select_reference,
    visual_issues,
)

OFFICIAL = "https://maker.example.com/x100"
RETAILER = "https://shop.example.com/x100"
OTHER = "https://blog.example.com/x100"
TALL = 100_000


def geometry(url: str, labels: list[str]) -> dict:
    blocks = [
        {"text": label, "context": label, "box": [100, 40 + 60 * index, 800, 20]} for index, label in enumerate(labels)
    ]
    return {
        "href": url,
        "width": 1920,
        "height": TALL,
        "viewportWidth": 1920,
        "viewportHeight": TALL,
        "scrollX": 0,
        "scrollY": 0,
        "blocks": blocks,
    }


def label(code: str) -> str:
    return f"Spec {code}: value {code}"


def source(code: str, url: str, tier: str, status: str = "NO_MATCH") -> VisualEvidence:
    return VisualEvidence(
        evidence_id=f"{code}@{url}",
        url=url,
        source_tier=tier,
        excerpt=label(code),
        fact_value=f"value {code}",
        capture_status=status,
        crop_path="crop.png" if status == "COMPLETE" else None,
    )


def attribute(code: str, *sources: VisualEvidence) -> CatalogAttribute:
    item = CatalogAttribute(code=code, name=code, value=f"value {code}", visual_evidence=list(sources))
    rank_references(item)
    select_reference(item)
    return item


def result(*attributes: CatalogAttribute) -> ProductEnrichment:
    return ProductEnrichment(
        ean="7891234567895",
        verified_brand="Maker",
        generated_title="X100",
        short_description="",
        meta_description="",
        fact_sheet=[],
        attributes=list(attributes),
        facts=[],
        research_summary="",
    )


class FakeFirecrawl:
    """Answers focused scrapes: every target is found and shot, except on the pages listed in ``refuse``."""

    def __init__(self, codes_by_page: dict[str, list[str]], refuse: dict[str, int] | None = None) -> None:
        self.codes_by_page = codes_by_page
        self.refuse = refuse or {}
        self.scrapes: list[tuple[str, list[str]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=png(1920, 2499))
        payload = json.loads(request.content)
        url = payload["url"]
        targets = [
            json.loads(action["script"][action["script"].rindex(")({") + 2 : -1])
            for action in payload["actions"]
            if action["type"] == "executeJavascript" and "data-catalog-evidence-target" in action["script"]
        ]
        self.scrapes.append((url, [target["value"] for target in targets]))
        if url in self.refuse:
            status = self.refuse[url]
            return httpx.Response(status, json={"success": False, "error": f"Refused with {status}"})
        page_map = geometry(url, [label(code) for code in self.codes_by_page[url]])
        returns = [{"href": url}]
        for _target in targets:
            returns += [{"href": url, "found": True, "revealedBy": []}, page_map, page_map]
        data = {
            "markdown": " ".join(label(code) for code in self.codes_by_page[url]),
            "metadata": {"url": url, "statusCode": 200, "creditsUsed": 1},
            "actions": {
                "screenshots": [
                    f"https://cdn.example.com/{len(self.scrapes)}-{index}.png" for index in range(len(targets))
                ],
                "javascriptReturns": [{"type": "executeJavascript", "value": json.dumps(item)} for item in returns],
            },
        }
        return httpx.Response(200, json={"success": True, "data": data})


def run_focus(
    tmp_path: Path,
    product: ProductEnrichment,
    firecrawl: FakeFirecrawl,
    **options,
) -> CaptureCollector:
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(firecrawl)) as http:
            collector = CaptureCollector("fc-key", EvidenceArchive(str(tmp_path)), "run-1", http_client=http, **options)
            collector.retry_wait = wait_none()
            for url, codes in firecrawl.codes_by_page.items():
                collector.pages[url] = PageCapture(
                    url=url,
                    status="CAPTURED",
                    geometry=geometry(url, [label(code) for code in codes]),
                    screenshot=png(1920, 2499),
                    source_text=" ".join(label(code) for code in codes),
                )
            async with collector:
                await collector.focus(product)
            return collector

    return asyncio.run(go())


def reference(item: CatalogAttribute) -> VisualEvidence | None:
    references = [evidence for evidence in item.visual_evidence if evidence.is_reference]
    assert len(references) <= 1
    return references[0] if references else None


def test_sources_are_ranked_by_tier_then_by_a_crop_already_taken():
    item = attribute(
        "a",
        source("a", OTHER, "other", "COMPLETE"),
        source("a", RETAILER, "recognized_retailer"),
        source("a", OFFICIAL, "official"),
        source("a", RETAILER + "?v=2", "recognized_retailer", "COMPLETE"),
    )
    assert [(evidence.url, evidence.source_rank) for evidence in item.visual_evidence] == [
        (OFFICIAL, 1),
        (RETAILER + "?v=2", 2),
        (RETAILER, 3),
        (OTHER, 4),
    ]
    # before any focused capture, the reference is the most reputable crop already taken
    assert reference(item).url == RETAILER + "?v=2"


def test_the_most_reputable_source_is_focused_even_when_a_lower_one_is_cropped(tmp_path):
    item = attribute("a", source("a", OFFICIAL, "official"), source("a", RETAILER, "recognized_retailer", "COMPLETE"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["a"], RETAILER: ["a"]})
    run_focus(tmp_path, result(item), firecrawl)
    assert firecrawl.scrapes == [(OFFICIAL, ["value a"])]
    assert reference(item).url == OFFICIAL


def test_a_refused_capture_falls_back_to_the_next_source_with_firecrawls_reason(tmp_path):
    item = attribute("a", source("a", OFFICIAL, "official"), source("a", RETAILER, "recognized_retailer", "COMPLETE"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["a"], RETAILER: ["a"]}, refuse={OFFICIAL: 400})
    run_focus(tmp_path, result(item), firecrawl)
    assert reference(item).url == RETAILER
    official = item.visual_evidence[0]
    assert official.capture_code == "FIRECRAWL_REJECTED"
    assert "Firecrawl answered HTTP 400: Refused with 400" in official.capture_error


def test_fallback_focuses_the_next_source_in_a_later_round(tmp_path):
    item = attribute("a", source("a", OFFICIAL, "official"), source("a", RETAILER, "recognized_retailer"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["a"], RETAILER: ["a"]}, refuse={OFFICIAL: 400})
    run_focus(tmp_path, result(item), firecrawl)
    assert [url for url, _values in firecrawl.scrapes] == [OFFICIAL, RETAILER]
    assert reference(item).url == RETAILER


def test_room_left_in_a_scrape_takes_the_reserves_of_that_page(tmp_path):
    first = attribute("a", source("a", RETAILER, "recognized_retailer"))
    second = attribute("b", source("b", OFFICIAL, "official"), source("b", RETAILER, "recognized_retailer"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["b"], RETAILER: ["a", "b"]}, refuse={OFFICIAL: 500})
    run_focus(tmp_path, result(first, second), firecrawl)
    # the official page is tried twice (500 is retried once); the retailer page served both values in one scrape
    assert sorted(firecrawl.scrapes) == sorted(
        [(OFFICIAL, ["value b"]), (OFFICIAL, ["value b"]), (RETAILER, ["value a", "value b"])]
    )
    assert reference(first).url == RETAILER
    assert reference(second).url == RETAILER


def test_many_values_on_a_page_take_more_scrapes_instead_of_being_dropped(tmp_path):
    codes = [f"v{index}" for index in range(12)]
    items = [attribute(code, source(code, RETAILER, "recognized_retailer")) for code in codes]
    firecrawl = FakeFirecrawl({RETAILER: codes})
    run_focus(tmp_path, result(*items), firecrawl)
    assert [len(values) for _url, values in firecrawl.scrapes] == [9, 3]
    assert all(reference(item) is not None for item in items)
    assert not any(evidence.capture_code == "TOO_MANY" for item in items for evidence in item.visual_evidence)


def test_budget_reaches_every_page_once_and_marks_what_it_could_not_pay(tmp_path):
    first = attribute("a", source("a", OFFICIAL, "official"))
    second = attribute("b", source("b", RETAILER, "recognized_retailer"), source("b", OTHER, "other", "COMPLETE"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["a"], RETAILER: ["b"], OTHER: ["b"]})
    run_focus(tmp_path, result(first, second), firecrawl, focus_max_credits=1)
    assert len(firecrawl.scrapes) == 1
    assert reference(first).url == OFFICIAL
    # without budget for its best source, the attribute still shows the crop it has
    assert reference(second).url == OTHER
    assert second.visual_evidence[0].capture_code == "BUDGET"


def test_out_of_credits_stops_every_further_paid_request(tmp_path):
    first = attribute("a", source("a", OFFICIAL, "official"))
    second = attribute("b", source("b", RETAILER, "recognized_retailer"))
    firecrawl = FakeFirecrawl({OFFICIAL: ["a"], RETAILER: ["b"]}, refuse={OFFICIAL: 402, RETAILER: 402})
    collector = run_focus(tmp_path, result(first, second), firecrawl, max_credits=3)
    assert collector.out_of_credits
    assert len(firecrawl.scrapes) == 1
    codes = {first.visual_evidence[0].capture_code, second.visual_evidence[0].capture_code}
    assert codes == {"OUT_OF_CREDITS"}


def test_an_attribute_without_a_reference_is_an_issue_and_rows_carry_the_selection():
    with_crop = attribute("a", source("a", RETAILER, "recognized_retailer", "COMPLETE"), source("a", OTHER, "other"))
    without = attribute("b", source("b", RETAILER, "recognized_retailer"))
    product = result(with_crop, without)
    assert [issue.field for issue in visual_issues(product)] == ["attributes.b"]
    rows = evidence_rows(product, "run-1")
    assert {name for row in rows for name in row} <= set(EVIDENCE_COLUMNS)
    assert [(row["attribute_code"], row["source_rank"], row["is_reference"]) for row in rows] == [
        ("a", 1, True),
        ("a", 2, False),
        ("b", 1, False),
    ]
    assert set(EVIDENCE_ADDED_COLUMNS) == {"capture_code", "source_rank", "is_reference"}
    # prepare ALTERs them into tables created before them (prepare.py needs Spark, so its source is checked)
    prepare = (Path(__file__).parents[1] / "src/brickfill/prepare.py").read_text(encoding="utf-8")
    assert '"product_attribute_evidence": EVIDENCE_ADDED_COLUMNS' in prepare


def test_firecrawl_error_keeps_its_explanation():
    request = httpx.Request("POST", "https://api.firecrawl.dev/v2/scrape")
    error = FirecrawlError(
        httpx.Response(
            400,
            json={"success": False, "error": "Bad Request", "details": [{"message": "Too many actions (max 50)"}]},
            request=request,
        )
    )
    assert str(error) == "Firecrawl answered HTTP 400: Bad Request; Too many actions (max 50)"
    assert FirecrawlError(httpx.Response(503, text="<html>", request=request)).reason == "Service Unavailable"
