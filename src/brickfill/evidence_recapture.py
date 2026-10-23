from __future__ import annotations

import asyncio
import json
import re
import uuid

import httpx
from databricks.sdk import WorkspaceClient

from brickfill.models import ProductEnrichment
from brickfill.research import canonicalize_url
from brickfill.secrets import firecrawl_api_key
from brickfill.visual_evidence import CaptureCollector, EvidenceArchive, evidence_rows


def select_attributes(result: ProductEnrichment, codes: list[str]) -> ProductEnrichment:
    if not 1 <= len(codes) <= 3 or len(set(codes)) != len(codes):
        raise ValueError("Recapture requires one to three distinct attribute codes")
    selected = result.model_copy(deep=True)
    selected.attributes = [item for item in selected.attributes if item.code in codes]
    if len(selected.attributes) != len(codes):
        raise ValueError("An attribute code was not found in the selected enrichment")
    for attribute in selected.attributes:
        if not (attribute.value or attribute.candidate_value) or not attribute.source_fact_names:
            raise ValueError(f"Attribute {attribute.code} must have a value and associated source facts")
    return selected


async def capture_recapture(
    result: ProductEnrichment,
    collector: CaptureCollector,
    *,
    track_credit_usage: bool = False,
) -> dict[str, int | None]:
    urls = list(
        dict.fromkeys(
            canonical
            for attribute in result.attributes
            for url in attribute.evidence_urls
            if (canonical := canonicalize_url(str(url)))
        )
    )
    usage: dict[str, int | None] = {}
    async with collector:
        if track_credit_usage:
            before = await collector.remaining_credits()
            if before < 1:
                raise ValueError("No Firecrawl credits remain; no paid request was made")
            usage["credits_before"] = before
            collector.max_credits = min(collector.max_credits or 3, before)
        for url in urls:
            await collector.scrape({"url": url})
        await asyncio.to_thread(collector.attach, result)
        await collector.focus(result)
        if track_credit_usage:
            try:
                after = await collector.remaining_credits()
            except (httpx.HTTPError, ValueError, TypeError, KeyError):
                # Do not lose evidence or retry paid calls when accounting is unavailable.
                after = None
            usage["credits_after"] = after
            usage["credits_consumed"] = before - after if after is not None else None
    return usage


def run(
    *,
    catalog: str,
    schema: str,
    ean: str,
    attribute_codes: str,
    secret_catalog: str,
    secret_schema: str,
    firecrawl_secret_key: str,
    evidence_volume: str = "brickfill_evidence",
    max_credits: int = 3,
) -> dict:
    """Capture evidence for up to three attributes of one SKU without re-enriching or publishing."""
    if not re.fullmatch(r"\d{8,14}", ean):
        raise ValueError("An explicit valid EAN is required; the recapture never selects or processes all SKUs")
    codes = [item.strip() for item in re.split("[,;]", attribute_codes) if item.strip()]
    if not 1 <= len(codes) <= 3 or len(set(codes)) != len(codes):
        raise ValueError("Specify one to three distinct attribute codes")
    if max_credits not in (1, 2, 3):
        raise ValueError("max_credits must be 1, 2 or 3")
    from databricks.sdk.runtime import dbutils, spark

    from brickfill.enrich import _append, _run_async, _schemas
    from brickfill.prepare import _identifier, initialize_output_tables

    catalog, schema, volume = (_identifier(value) for value in (catalog, schema, evidence_volume))
    namespace = f"`{catalog}`.`{schema}`"
    source = (
        spark.table(f"{namespace}.product_catalog")
        .where(f"ean = '{ean}'")
        .select(
            "run_id",
            "result_json",
        )
        .collect()
    )
    if not source or not source[0]["result_json"]:
        raise ValueError("Select one SKU with an existing enrichment")
    selected = select_attributes(ProductEnrichment.model_validate_json(source[0]["result_json"]), codes)
    run_id = str(uuid.uuid4())
    workspace = WorkspaceClient()
    key = firecrawl_api_key(dbutils, catalog=secret_catalog, schema=secret_schema, key=firecrawl_secret_key)
    collector = CaptureCollector(
        key,
        EvidenceArchive(f"/Volumes/{catalog}/{schema}/{volume}", workspace),
        run_id,
        max_credits=max_credits,
    )
    initialize_output_tables(namespace)
    usage = _run_async(capture_recapture(selected, collector, track_credit_usage=True))
    # "PILOT" and pilot.json are the stored contract of a recapture: the app reads them, also for older captures
    _append(
        evidence_rows(selected, run_id, capture_mode="PILOT", source_run_id=source[0]["run_id"]),
        _schemas()["evidence"],
        f"{namespace}.product_attribute_evidence",
    )
    collector.archive.write(
        f"{run_id}/pilot.json",
        json.dumps(
            {
                "capture_mode": "PILOT",
                "capture_run_id": run_id,
                "ean": ean,
                "source_run_id": source[0]["run_id"],
                "credit_usage": usage,
                "attributes": [
                    {
                        "code": attribute.code,
                        "value": attribute.value,
                        "candidate_value": attribute.candidate_value,
                        "visual_evidence": [item.model_dump(mode="json") for item in attribute.visual_evidence],
                    }
                    for attribute in selected.attributes
                ],
            },
            ensure_ascii=False,
        ).encode(),
    )
    summary = {
        "capture_run_id": run_id,
        "ean": ean,
        "attribute_codes": codes,
        "paid_request_attempts": collector.attempts,
        "reported_credits": collector.reported_credits,
        **usage,
        "audit_path": f"/catalog/{ean}?evidence_run={run_id}",
        "statuses": {
            attribute.code: [item.capture_status for item in attribute.visual_evidence]
            for attribute in selected.attributes
        },
        "capture_errors": {
            attribute.code: [item.capture_error for item in attribute.visual_evidence if item.capture_error]
            for attribute in selected.attributes
        },
        "published_enrichment": False,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary
