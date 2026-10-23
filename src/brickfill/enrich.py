from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Coroutine
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TypeVar

from databricks.sdk.runtime import dbutils, spark
from pyspark.sql.types import BooleanType, DoubleType, LongType, StringType, StructField, StructType, TimestampType

from brickfill.agent import CatalogResearchAgent
from brickfill.content.loader import EffectiveRules, effective_rules
from brickfill.errors import safe_exception_message
from brickfill.issues import make
from brickfill.lakebase import Decision, closed_reviews_from, connect, pending_reviews
from brickfill.models import (
    AttributeDefinition,
    ProductEnrichment,
    ProductSeed,
    Severity,
    ValidationIssue,
    parse_eans,
)
from brickfill.quality import quality_score, validate_enrichment
from brickfill.secrets import firecrawl_api_key
from brickfill.settings import EffectiveSettings, JobDefaults, SettingsSnapshot, read_settings, resolve
from brickfill.visual_evidence import (
    EVIDENCE_COLUMNS,
    CaptureCollector,
    EvidenceArchive,
    evidence_rows,
    visual_issues,
)

PROMPT_VERSION = "brickfill-v1"
T = TypeVar("T")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _run_async(coroutine: Coroutine[Any, Any, T]) -> T:
    """Run async work from both regular Python and Databricks IPython runtimes."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="brickfill-async") as executor:
        return executor.submit(asyncio.run, coroutine).result()


def _append(rows: list[dict[str, Any]], schema: StructType, table: str) -> None:
    if rows:
        spark.createDataFrame(rows, schema=schema).write.mode("append").saveAsTable(table)


def _definitions(namespace: str, seed: ProductSeed) -> list[AttributeDefinition]:
    # Values come from the retailer's tables: bind them as parameters, never interpolate them into the SQL.
    rows = spark.sql(
        f"""SELECT attribute_code, attribute_name, required, attribute_description, value_type, unit,
               attribute_role, allows_free_text
        FROM {namespace}.attribute_definition
        WHERE subcategory_id = :subcategory_id
        ORDER BY required DESC, sort_order NULLS LAST, attribute_name""",
        args={"subcategory_id": seed.subcategory_id},
    ).collect()
    codes = [str(row["attribute_code"]) for row in rows]
    vocabulary_by_code: dict[str, list[str]] = {code: [] for code in codes}
    if codes:
        markers = ", ".join(f":code_{index}" for index in range(len(codes)))
        vocabulary_rows = spark.sql(
            f"""SELECT DISTINCT attribute_code, allowed_value
            FROM {namespace}.attribute_allowed_value
            WHERE attribute_code IN ({markers})
            ORDER BY attribute_code, allowed_value""",
            args={f"code_{index}": code for index, code in enumerate(codes)},
        ).collect()
        for item in vocabulary_rows:
            vocabulary_by_code.setdefault(str(item["attribute_code"]), []).append(item["allowed_value"])

    definitions: list[AttributeDefinition] = []
    for row in rows:
        code = str(row["attribute_code"])
        definitions.append(
            AttributeDefinition(
                code=code,
                name=row["attribute_name"],
                required=bool(row["required"]),
                vocabulary=vocabulary_by_code.get(code, []),
                description=row["attribute_description"] or "",
                value_type=row["value_type"] or "text",
                unit=row["unit"] or "",
                role=row["attribute_role"] or "",
                allows_free_text=bool(row["allows_free_text"]),
            )
        )
    return definitions


async def _run_one(
    semaphore: asyncio.Semaphore,
    agent: CatalogResearchAgent,
    namespace: str,
    seed: ProductSeed,
    rules: EffectiveRules,
) -> tuple[ProductSeed, ProductEnrichment | None, list[ValidationIssue], str | None]:
    async with semaphore:
        try:
            # spark.sql blocks; run it off the event loop so the other products keep waiting on the model in parallel
            definitions = await asyncio.to_thread(_definitions, namespace, seed)
            result = await agent.enrich(seed, definitions, rules)
            issues = validate_enrichment(seed, result, definitions, rules)
            if agent.capture_collector is not None:
                await asyncio.to_thread(agent.capture_collector.attach, result)
                # values on the page that the full screenshot did not show: open their section and capture the window
                await agent.capture_collector.focus(result)
                issues.extend(visual_issues(result))
                # scrape credits of the pages this product used (full and focused captures), for the cost telemetry
                urls = [str(url) for url in result.research_trace.scraped_urls]
                result.research_trace.firecrawl_credits = agent.capture_collector.credits_for(urls)
            return seed, result, issues, None
        except Exception as exc:  # noqa: BLE001 - isolate failures so the remaining SKUs continue
            safe_error = safe_exception_message(exc, agent.api_key)
            issue = make("AGENT_FAILURE", Severity.ERROR, "agent", error=safe_error)
            return seed, None, [issue], safe_error


def _schemas() -> dict[str, StructType]:
    return {
        "evidence": StructType(
            [
                StructField(name, TimestampType() if kind == "TIMESTAMP" else StringType(), True)
                for name, kind in EVIDENCE_COLUMNS.items()
            ]
        ),
        "run": StructType(
            [
                StructField("run_id", StringType(), False),
                StructField("started_at", TimestampType(), False),
                StructField("completed_at", TimestampType(), False),
                StructField("model_endpoint", StringType(), False),
                StructField("prompt_version", StringType(), False),
                StructField("product_count", LongType(), False),
                StructField("success_count", LongType(), False),
                StructField("failure_count", LongType(), False),
                StructField("status", StringType(), False),
                StructField("settings_json", StringType(), True),
            ]
        ),
        "enrichment": StructType(
            [
                StructField("run_id", StringType(), False),
                StructField("ean", StringType(), False),
                StructField("generated_title", StringType(), True),
                StructField("short_description", StringType(), True),
                StructField("meta_description", StringType(), True),
                StructField("verified_brand", StringType(), True),
                StructField("model", StringType(), True),
                StructField("supplier", StringType(), True),
                StructField("quality_score", DoubleType(), False),
                StructField("status", StringType(), False),
                StructField("result_json", StringType(), True),
                StructField("created_at", TimestampType(), False),
                StructField("content_language", StringType(), True),
                StructField("content_profile", StringType(), True),
                StructField("settings_hash", StringType(), True),
            ]
        ),
        "fact": StructType(
            [
                StructField("run_id", StringType(), False),
                StructField("ean", StringType(), False),
                StructField("fact_name", StringType(), False),
                StructField("fact_value", StringType(), False),
                StructField("normalized_value", StringType(), True),
                StructField("confidence", DoubleType(), False),
                StructField("evidence_json", StringType(), False),
                StructField("created_at", TimestampType(), False),
            ]
        ),
        "attribute": StructType(
            [
                StructField("run_id", StringType(), False),
                StructField("ean", StringType(), False),
                StructField("attribute_code", StringType(), False),
                StructField("attribute_name", StringType(), False),
                StructField("attribute_value", StringType(), True),
                StructField("required", BooleanType(), False),
                StructField("applicable", BooleanType(), False),
                StructField("confidence", DoubleType(), False),
                StructField("evidence_urls_json", StringType(), False),
                StructField("observation", StringType(), True),
                StructField("created_at", TimestampType(), False),
                StructField("candidate_value", StringType(), True),
                StructField("normalized_value", StringType(), True),
                StructField("mapping_status", StringType(), True),
                StructField("source_fact_names_json", StringType(), False),
                StructField("rejection_reason", StringType(), True),
                StructField("applicability_reason", StringType(), True),
                StructField("rejection_code", StringType(), True),
                StructField("applicability_code", StringType(), True),
            ]
        ),
        "issue": StructType(
            [
                StructField("run_id", StringType(), False),
                StructField("ean", StringType(), False),
                StructField("issue_code", StringType(), False),
                StructField("severity", StringType(), False),
                StructField("field", StringType(), False),
                StructField("message", StringType(), False),
                StructField("created_at", TimestampType(), False),
                StructField("params_json", StringType(), True),
            ]
        ),
    }


def load_seeds(namespace: str, ean: str) -> list[ProductSeed]:
    """The products listed in ``ean`` (one EAN or a list), enriched again even if they already were."""
    frame = spark.table(f"{namespace}.product_input")
    frame = frame.where(frame.ean.isin(parse_eans(ean)))
    return [ProductSeed(**row.asDict()) for row in frame.orderBy("ean").collect()]


def batch_size(capacity: int, pending: int, max_products: int = 0) -> int | None:
    """New products for this run: the free places of the review queue, at most ``max_products``.

    ``capacity`` is reviewers x products per reviewer and ``pending`` the enriched products whose latest result is not
    approved or rejected yet (``lakebase.pending_reviews``); 0 turns either limit off. ``None`` means no limit (every product not enriched yet).
    """
    limits = [max(0, capacity - pending)] if capacity > 0 else []
    if max_products > 0:
        limits.append(max_products)
    return min(limits) if limits else None


def new_products_query(namespace: str, limit: int | None) -> str:
    """Products never enriched (no result, successful or not), grouped by category and subcategory so a batch
    holds similar products with the same attributes. A product is enriched again only through ``ean``."""
    query = (
        f"SELECT p.* FROM {namespace}.product_input p "
        f"LEFT ANTI JOIN {namespace}.product_enrichment e ON p.ean = e.ean "
        "ORDER BY p.category_id, p.subcategory_id, p.ean"
    )
    return query if limit is None else f"{query} LIMIT {int(limit)}"


def latest_results_query(namespace: str) -> str:
    """The latest result of each product still in the catalog (the one the app shows), as in the product_catalog view.
    Products removed from the source or made inactive leave ``product_input`` and the app's queue, so their old
    results never hold places in the review queue."""
    return (
        "SELECT e.ean, max_by(e.run_id, e.created_at) AS run_id, max(e.created_at) AS created_at "
        f"FROM {namespace}.product_enrichment e "
        f"LEFT SEMI JOIN {namespace}.product_input p ON e.ean = p.ean "
        "GROUP BY e.ean"
    )


@dataclass(frozen=True)
class Batch:
    seeds: list[ProductSeed]
    capacity: int = 0
    pending: int = 0
    limit: int | None = None
    listed: bool = False
    settings: SettingsSnapshot = field(default_factory=SettingsSnapshot)

    def summary(self) -> str:
        if self.listed:
            return f"{len(self.seeds)} products listed in ean (enriched again even if they already were)"
        if self.capacity <= 0:
            queue = "review capacity off"
        else:
            queue = f"review capacity {self.capacity}, {self.pending} awaiting review"
        limit = "no limit" if self.limit is None else f"up to {self.limit}"
        return f"{queue}; batch {limit}: {len(self.seeds)} new products"


def next_batch(namespace: str, *, capacity: int, closed: dict[str, Decision], max_products: int = 0) -> Batch:
    """The next products to enrich: the ones never enriched, as many as fit in the review queue."""
    results = spark.sql(latest_results_query(namespace)).collect()
    latest = {row.ean: Decision(row.run_id, row.created_at) for row in results}
    pending = pending_reviews(latest, closed)
    limit = batch_size(capacity, pending, max_products)
    rows = [] if limit == 0 else spark.sql(new_products_query(namespace, limit)).collect()
    return Batch([ProductSeed(**row.asDict()) for row in rows], capacity, pending, limit)


def select_products(
    namespace: str,
    *,
    ean: str = "",
    max_products: int = 0,
    capacity: int = 0,
    lakebase_endpoint: str = "",
    lakebase_database: str = "databricks_postgres",
    lakebase_schema: str = "brickfill_app",
) -> Batch:
    """The EANs in ``ean`` when given; otherwise the next batch that fits in the review queue.

    One Lakebase read serves the batch: the reviews (for the queue size) and the settings saved in the app. With an
    endpoint configured, a failed read fails the run, so content is never generated with the wrong settings;
    ``capacity`` 0 enriches every product not enriched yet (up to ``max_products``).
    """
    closed: dict[str, Decision] = {}
    settings = SettingsSnapshot()
    if lakebase_endpoint:
        with connect(lakebase_endpoint, lakebase_database) as connection:
            settings = read_settings(connection, lakebase_schema)
            if capacity > 0 and not parse_eans(ean):
                closed = closed_reviews_from(connection, lakebase_schema)
    elif capacity > 0 and not parse_eans(ean):
        raise ValueError("lakebase_endpoint is required to size the batch by the review queue (reviewers > 0)")
    if parse_eans(ean):
        return Batch(load_seeds(namespace, ean), listed=True, settings=settings)
    batch = next_batch(namespace, capacity=capacity, closed=closed, max_products=max_products)
    return Batch(batch.seeds, batch.capacity, batch.pending, batch.limit, settings=settings)


class RulesResolver:
    """Effective settings and rules of each product, built once per distinct combination."""

    def __init__(self, snapshot: SettingsSnapshot, defaults: JobDefaults) -> None:
        self.snapshot = snapshot
        self.defaults = defaults
        self.by_ean: dict[str, EffectiveSettings] = {}
        self._rules: dict[tuple, EffectiveRules] = {}

    def __call__(self, seed: ProductSeed) -> EffectiveRules:
        settings = resolve(self.snapshot, self.defaults, seed)
        self.by_ean[seed.ean] = settings
        if settings.key not in self._rules:
            self._rules[settings.key] = effective_rules(
                settings.content_profile,
                settings.overrides,
                content_language=settings.content_language,
                catalog_language=settings.catalog_language,
                market=settings.market or None,
            )
        return self._rules[settings.key]

    def record(self) -> dict[str, Any]:
        """What enrichment_run.settings_json keeps: the snapshot, the job defaults and each distinct resolution."""
        resolved: dict[str, Any] = {}
        for ean, settings in self.by_ean.items():
            entry = resolved.setdefault(settings.hash, {**settings.as_dict(), "products": 0})
            entry["products"] += 1
            entry.setdefault("sample_ean", ean)
        return {"snapshot": self.snapshot.as_dict(), "job_defaults": self.defaults.as_dict(), "resolved": resolved}


def research(
    seeds: list[ProductSeed],
    *,
    namespace: str,
    catalog: str,
    schema: str,
    run_id: str,
    model_endpoint: str,
    firecrawl_mcp_url: str,
    firecrawl_key: str,
    evidence_volume: str = "brickfill_evidence",
    concurrency: int = 2,
    firecrawl_concurrency: int = 2,
    use_native_web_search: bool = False,
    rules_for: RulesResolver | None = None,
) -> list[tuple[ProductSeed, ProductEnrichment | None, list[ValidationIssue], str | None]]:
    """Research, validate and capture visual evidence for every seed (concurrently).

    ``concurrency`` products are researched at the same time (they mostly wait on the model); every Firecrawl request
    of the run shares ``firecrawl_concurrency`` slots, the limit of the Firecrawl plan (2 on the free plan).
    ``rules_for`` gives each product its language, profile and market (job parameters and app settings).
    """
    rules_for = rules_for or RulesResolver(SettingsSnapshot(), JobDefaults())
    # Resolved before any paid request, so an unknown language or profile fails the run immediately.
    rules = {seed.ean: rules_for(seed) for seed in seeds}
    agent = CatalogResearchAgent(
        model_endpoint, firecrawl_mcp_url, firecrawl_key, use_native_web_search=use_native_web_search
    )
    # market is a global setting: every product of the run shares the same scrape location
    market = next((item.market for item in rules.values() if item.market), None)
    collector = CaptureCollector(
        firecrawl_key,
        EvidenceArchive(f"/Volumes/{catalog}/{schema}/{evidence_volume}", agent.workspace),
        run_id,
        concurrency=firecrawl_concurrency,
        location={"country": market.country, "languages": market.languages} if market else None,
    )
    agent.capture_collector = collector

    async def run_all():
        semaphore = asyncio.Semaphore(max(1, concurrency))
        # fails the run before any Firecrawl credit is spent when the endpoint rejects the request shape
        await agent.check_model()
        async with collector:
            return await asyncio.gather(
                *(_run_one(semaphore, agent, namespace, seed, rules[seed.ean]) for seed in seeds)
            )

    return _run_async(run_all())


def build_rows(
    outcomes, run_id: str, settings_by_ean: dict[str, EffectiveSettings] | None = None
) -> dict[str, list[dict[str, Any]]]:
    """Flatten the research outcomes into one list of rows per output table."""
    created_at = _now()
    settings_by_ean = settings_by_ean or {}

    def settings_columns(ean: str) -> dict[str, Any]:
        settings = settings_by_ean.get(ean)
        return {
            "content_language": settings.content_language if settings else None,
            "content_profile": settings.content_profile if settings else None,
            "settings_hash": settings.hash if settings else None,
        }

    enrichment_rows: list[dict[str, Any]] = []
    fact_rows: list[dict[str, Any]] = []
    attribute_rows: list[dict[str, Any]] = []
    issue_rows: list[dict[str, Any]] = []
    visual_rows: list[dict[str, Any]] = []

    for seed, result, issues, _error in outcomes:
        status = "REVIEW_REQUIRED" if any(issue.severity == Severity.ERROR for issue in issues) else "ENRICHED"
        score = quality_score(result, issues) if result else 0.0
        if result:
            visual_rows.extend(evidence_rows(result, run_id))
            enrichment_rows.append(
                {
                    "run_id": run_id,
                    "ean": seed.ean,
                    "generated_title": result.generated_title,
                    "short_description": result.short_description,
                    "meta_description": result.meta_description,
                    "verified_brand": result.verified_brand,
                    "model": result.model,
                    "supplier": result.supplier,
                    "quality_score": score,
                    "status": status,
                    "result_json": result.json_for_storage(),
                    "created_at": created_at,
                    **settings_columns(seed.ean),
                }
            )
            for fact in result.facts:
                fact_rows.append(
                    {
                        "run_id": run_id,
                        "ean": seed.ean,
                        "fact_name": fact.name,
                        "fact_value": fact.value,
                        "normalized_value": fact.normalized_value,
                        "confidence": fact.confidence,
                        "evidence_json": json.dumps(
                            [e.model_dump(mode="json") for e in fact.evidence], ensure_ascii=False
                        ),
                        "created_at": created_at,
                    }
                )
            for attribute in result.attributes:
                attribute_rows.append(
                    {
                        "run_id": run_id,
                        "ean": seed.ean,
                        "attribute_code": attribute.code,
                        "attribute_name": attribute.name,
                        "attribute_value": attribute.value,
                        "required": attribute.required,
                        "applicable": attribute.applicable,
                        "confidence": attribute.confidence,
                        "evidence_urls_json": json.dumps(
                            [str(url) for url in attribute.evidence_urls], ensure_ascii=False
                        ),
                        "observation": attribute.observation,
                        "created_at": created_at,
                        "candidate_value": attribute.candidate_value,
                        "normalized_value": attribute.normalized_value,
                        "mapping_status": attribute.mapping_status.value if attribute.mapping_status else None,
                        "source_fact_names_json": json.dumps(attribute.source_fact_names, ensure_ascii=False),
                        "rejection_reason": attribute.rejection_reason,
                        "applicability_reason": attribute.applicability_reason,
                        "rejection_code": attribute.rejection_code,
                        "applicability_code": attribute.applicability_code,
                    }
                )
        else:
            enrichment_rows.append(
                {
                    "run_id": run_id,
                    "ean": seed.ean,
                    "generated_title": None,
                    "short_description": None,
                    "meta_description": None,
                    "verified_brand": None,
                    "model": None,
                    "supplier": None,
                    "quality_score": 0.0,
                    "status": "REVIEW_REQUIRED",
                    "result_json": None,
                    "created_at": created_at,
                    **settings_columns(seed.ean),
                }
            )
        for issue in issues:
            issue_rows.append(
                {
                    "run_id": run_id,
                    "ean": seed.ean,
                    "issue_code": issue.code,
                    "severity": issue.severity.value,
                    "field": issue.field,
                    "message": issue.message,
                    "created_at": created_at,
                    "params_json": json.dumps(issue.params, ensure_ascii=False),
                }
            )

    return {
        "fact": fact_rows,
        "attribute": attribute_rows,
        "issue": issue_rows,
        "evidence": visual_rows,
        "enrichment": enrichment_rows,
    }


def write_results(
    namespace: str,
    rows: dict[str, list[dict[str, Any]]],
    *,
    run_id: str,
    started_at: datetime,
    model_endpoint: str,
    product_count: int,
    success_count: int,
    settings: dict[str, Any] | None = None,
) -> None:
    """Append the rows to the Delta tables; ``product_enrichment`` goes last (it is the publication marker)."""

    schemas = _schemas()
    # product_enrichment is the publication marker used by product_catalog. Write it last so
    # consumers never observe a new run before its facts, attributes and validations are complete.
    _append(rows["fact"], schemas["fact"], f"{namespace}.product_fact")
    _append(rows["attribute"], schemas["attribute"], f"{namespace}.product_attribute")
    _append(rows["issue"], schemas["issue"], f"{namespace}.validation_issue")
    _append(rows["evidence"], schemas["evidence"], f"{namespace}.product_attribute_evidence")
    _append(rows["enrichment"], schemas["enrichment"], f"{namespace}.product_enrichment")
    _append(
        [
            {
                "run_id": run_id,
                "started_at": started_at,
                "completed_at": _now(),
                "model_endpoint": model_endpoint,
                "prompt_version": PROMPT_VERSION,
                "product_count": product_count,
                "success_count": success_count,
                "failure_count": product_count - success_count,
                "status": "SUCCEEDED" if success_count == product_count else "COMPLETED_WITH_ERRORS",
                "settings_json": json.dumps(settings, ensure_ascii=False, default=str) if settings else None,
            }
        ],
        schemas["run"],
        f"{namespace}.enrichment_run",
    )


def run(
    *,
    catalog: str,
    schema: str,
    model_endpoint: str,
    firecrawl_mcp_url: str,
    firecrawl_secret_key: str = "firecrawl_api_key",
    secret_catalog: str = "",
    secret_schema: str = "",
    max_products: int = 0,
    concurrency: int = 2,
    firecrawl_concurrency: int = 2,
    ean: str = "",
    evidence_volume: str = "brickfill_evidence",
    use_native_web_search: bool = False,
    reviewers: int = 0,
    products_per_reviewer: int = 0,
    lakebase_endpoint: str = "",
    lakebase_database: str = "databricks_postgres",
    lakebase_schema: str = "brickfill_app",
    content_language: str = "en",
    catalog_language: str = "",
    content_profile: str = "default",
    market: str = "",
) -> str:
    """Whole enrichment in one call (the notebook runs the same steps in separate cells). Returns the run id, or an
    empty string when the review queue is full and no product was enriched.

    The Firecrawl key is the Unity Catalog secret ``secret_catalog.secret_schema.firecrawl_secret_key`` (by default in
    the working catalog and schema).
    """
    namespace = f"`{catalog}`.`{schema}`"
    batch = select_products(
        namespace,
        ean=ean,
        max_products=max_products,
        capacity=reviewers * products_per_reviewer,
        lakebase_endpoint=lakebase_endpoint,
        lakebase_database=lakebase_database,
        lakebase_schema=lakebase_schema,
    )
    print(batch.summary())
    seeds = batch.seeds
    if not seeds:
        return ""
    resolver = RulesResolver(
        batch.settings, JobDefaults(content_language, catalog_language, content_profile, market.strip().upper())
    )
    firecrawl_key = firecrawl_api_key(
        dbutils, catalog=secret_catalog or catalog, schema=secret_schema or schema, key=firecrawl_secret_key
    )
    run_id, started_at = str(uuid.uuid4()), _now()
    outcomes = research(
        seeds,
        namespace=namespace,
        catalog=catalog,
        schema=schema,
        run_id=run_id,
        model_endpoint=model_endpoint,
        firecrawl_mcp_url=firecrawl_mcp_url,
        firecrawl_key=firecrawl_key,
        evidence_volume=evidence_volume,
        concurrency=concurrency,
        firecrawl_concurrency=firecrawl_concurrency,
        use_native_web_search=use_native_web_search,
        rules_for=resolver,
    )
    rows = build_rows(outcomes, run_id, resolver.by_ean)
    success_count = sum(1 for _seed, result, _issues, _error in outcomes if result)
    write_results(
        namespace,
        rows,
        run_id=run_id,
        started_at=started_at,
        model_endpoint=model_endpoint,
        product_count=len(seeds),
        success_count=success_count,
        settings=resolver.record(),
    )
    print(f"Run {run_id}: {success_count}/{len(seeds)} products enriched")
    return run_id
