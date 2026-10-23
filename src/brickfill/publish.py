from __future__ import annotations

from brickfill.identifiers import identifier as _identifier
from brickfill.identifiers import qualified_table as _qualified_table
from brickfill.lakebase import connect, naive_utc, run_column, table_exists


def destination_ddl(destination_table: str) -> str:
    return f"""CREATE TABLE IF NOT EXISTS {_qualified_table(destination_table)} (
      product_id STRING COMMENT 'Retailer item id (v_products.product_id)',
      gtin STRING COMMENT 'GTIN of the item (v_products.gtin); key of the table',
      department STRING, category STRING, subcategory STRING,
      title STRING, short_description STRING, meta_description STRING,
      brand STRING, model STRING, supplier STRING,
      attributes_json STRING COMMENT 'Array of {{code, name, value, source, evidence}}; source is AI, HUMAN, HUMAN_NO_EVIDENCE or MISSING; evidence is a list of {{origin, url, excerpt, screenshot_path, crop_path}} (origin AI or HUMAN)',
      content_language STRING COMMENT 'Language the content was written in (en, pt-BR, es, ...)',
      run_id STRING, quality_score DOUBLE,
      approved_by STRING, approved_at TIMESTAMP, review_notes STRING
    ) USING DELTA
    COMMENT 'BrickFill: products approved in the review app, with the origin and evidence of every value'"""


REVIEW_VIEW = "approved_review"
OVERRIDE_VIEW = "active_override"
MANUAL_EVIDENCE_VIEW = "active_manual_evidence"


DESTINATION_COLUMNS = (
    "product_id", "gtin", "department", "category", "subcategory",
    "title", "short_description", "meta_description",
    "brand", "model", "supplier",
    "attributes_json",
    "content_language",
    "run_id", "quality_score",
    "approved_by", "approved_at", "review_notes",
)  # fmt: skip


def _approved_ctes(namespace: str) -> str:
    """``approved`` (the APPROVED reviews), ``latest`` (the result each approval holds for, when it is publishable)
    and ``reopened`` (reviews back IN_REVIEW: an edit or evidence changed after the approval, or a reviewer reopened
    it), shared by the MERGE and its plan so the counts and the publication never disagree.

    An approval holds for the enrichment run the reviewer approved; an approval saved before the app recorded the
    run holds for a result not newer than it (the rule of ``lakebase.decision_applies``). A newer result (the
    product was enriched again) or a failed one (no content) is not publishable until a reviewer approves it.
    """
    return f"""approved AS (
    SELECT product_ean AS ean, run_id, updated_by AS approved_by, updated_at AS approved_at, notes
    FROM {REVIEW_VIEW}
    WHERE status = 'APPROVED'
  ), latest AS (
    SELECT c.* FROM {namespace}.product_catalog c JOIN approved a ON c.ean = a.ean
    WHERE c.run_id IS NOT NULL AND c.result_json IS NOT NULL
      AND (c.run_id = a.run_id OR (a.run_id IS NULL AND c.created_at <= a.approved_at))
  ), reopened AS (
    SELECT product_ean AS ean FROM {REVIEW_VIEW} WHERE status = 'IN_REVIEW'
  )"""


def merge_statement(namespace: str, destination_table: str) -> str:
    """MERGE that makes the destination hold the products currently APPROVED in the app, and only them.

    The source has one row per approved or reopened product. A product leaves the destination only when it is
    rejected or set back to pending. An approved product without a publishable result (``_approved_ctes``: it was
    enriched again after the approval, the new run failed, or its catalog row is missing at publication time) and a
    reopened one (``IN_REVIEW``: changed after the approval) keep their last published version untouched until a
    reviewer approves the current content.

    The effective view of a product is the approved AI result with the active human overrides applied (the app
    reopens the review whenever an edit or an evidence changes, so an approval always covers the current edits).
    Attributes without a value stay in the payload with source MISSING instead of being dropped; an attribute the
    AI marked as not applicable is published only when a reviewer edited it.
    Every value carries its evidence: an AI value keeps the sources and captures of its enrichment run plus the
    manual evidence attached to it on that run; an edited value carries the manual evidence of that edit. An edit
    without evidence (made before evidence became mandatory) is published as HUMAN_NO_EVIDENCE.
    ``approved_review``, ``active_override`` and ``active_manual_evidence`` are temporary views over the app's
    Lakebase tables.
    """
    updates = ", ".join(f"target.{column} = source.{column}" for column in DESTINATION_COLUMNS)
    columns = ", ".join(DESTINATION_COLUMNS)
    values = ", ".join(f"source.{column}" for column in DESTINATION_COLUMNS)
    return f"""
MERGE INTO {_qualified_table(destination_table)} AS target
USING (
  WITH {_approved_ctes(namespace)}, overrides AS (
    SELECT id, product_ean AS ean, attribute_code, value
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY product_ean, attribute_code ORDER BY created_at DESC) AS row_number
      FROM {OVERRIDE_VIEW}
    ) WHERE row_number = 1
  ), ai_evidence AS (
    SELECT e.ean, e.attribute_code,
           collect_list(named_struct(
             'origin', 'AI', 'url', e.url, 'excerpt', NULLIF(e.excerpt, ''),
             'screenshot_path', NULLIF(e.screenshot_path, ''), 'crop_path', NULLIF(e.crop_path, ''))) AS items
    FROM {namespace}.product_attribute_evidence e
    JOIN latest l ON e.run_id = l.run_id AND e.ean = l.ean
    WHERE e.capture_mode = 'ENRICHMENT'
    GROUP BY e.ean, e.attribute_code
  ), manual_evidence AS (
    SELECT product_ean AS ean, attribute_code, override_id,
           collect_list(named_struct(
             'origin', 'HUMAN', 'url', source_url, 'excerpt', excerpt,
             'screenshot_path', screenshot_path, 'crop_path', CAST(NULL AS STRING))) AS items
    FROM {MANUAL_EVIDENCE_VIEW}
    WHERE override_id IS NOT NULL
    GROUP BY product_ean, attribute_code, override_id
  ), confirmed_evidence AS (
    -- evidence a reviewer attached to the AI value, only when it was attached on the published run
    SELECT e.product_ean AS ean, e.attribute_code,
           collect_list(named_struct(
             'origin', 'HUMAN', 'url', e.source_url, 'excerpt', e.excerpt,
             'screenshot_path', e.screenshot_path, 'crop_path', CAST(NULL AS STRING))) AS items
    FROM {MANUAL_EVIDENCE_VIEW} e
    JOIN latest l ON l.ean = e.product_ean
    WHERE e.override_id IS NULL
      AND (e.run_id = l.run_id OR (e.run_id IS NULL AND e.created_at >= l.created_at))
    GROUP BY e.product_ean, e.attribute_code
  ), decided AS (
    SELECT ean, approved_by, approved_at, notes FROM approved
    UNION ALL
    SELECT ean, NULL, NULL, NULL FROM reopened
  ), attributes AS (
    SELECT l.ean,
           to_json(collect_list(named_struct(
             'code', a.attribute_code,
             'name', a.attribute_name,
             'value', COALESCE(o.value, a.attribute_value),
             'source', CASE WHEN o.value IS NOT NULL AND human.items IS NOT NULL THEN 'HUMAN'
                            WHEN o.value IS NOT NULL THEN 'HUMAN_NO_EVIDENCE'
                            WHEN a.attribute_value IS NOT NULL THEN 'AI' ELSE 'MISSING' END,
             'evidence', CASE
               WHEN o.value IS NOT NULL THEN COALESCE(human.items, array())
               WHEN a.attribute_value IS NULL THEN array()
               ELSE concat(
                 COALESCE(ai.items, transform(
                   from_json(a.evidence_urls_json, 'array<string>'),
                   url -> named_struct('origin', 'AI', 'url', url, 'excerpt', CAST(NULL AS STRING),
                                       'screenshot_path', CAST(NULL AS STRING), 'crop_path', CAST(NULL AS STRING)))),
                 COALESCE(confirmed.items, array()))
             END))) AS items
    FROM {namespace}.product_attribute a
    JOIN latest l ON a.run_id = l.run_id AND a.ean = l.ean
    LEFT JOIN overrides o ON o.ean = a.ean AND o.attribute_code = a.attribute_code
    LEFT JOIN ai_evidence ai ON ai.ean = a.ean AND ai.attribute_code = a.attribute_code
    LEFT JOIN manual_evidence human
      ON human.ean = a.ean AND human.attribute_code = a.attribute_code AND human.override_id = o.id
    LEFT JOIN confirmed_evidence confirmed ON confirmed.ean = a.ean AND confirmed.attribute_code = a.attribute_code
    WHERE a.applicable OR o.value IS NOT NULL
    GROUP BY l.ean
  )
  SELECT d.ean AS gtin, l.product_id, l.department, l.category, l.subcategory,
         COALESCE(l.generated_title, l.source_title) AS title,
         l.short_description, l.meta_description,
         COALESCE(l.verified_brand, NULLIF(l.source_brand, '')) AS brand,
         l.model, l.supplier,
         COALESCE(t.items, '[]') AS attributes_json,
         l.content_language,
         l.run_id, l.quality_score,
         d.approved_by, CAST(d.approved_at AS TIMESTAMP) AS approved_at, d.notes AS review_notes,
         l.ean IS NOT NULL AS publishable
  FROM decided d
  LEFT JOIN latest l ON l.ean = d.ean
  LEFT JOIN attributes t ON t.ean = d.ean
) AS source
ON target.gtin = source.gtin
WHEN MATCHED AND source.publishable THEN UPDATE SET {updates}
WHEN NOT MATCHED AND source.publishable THEN INSERT ({columns}) VALUES ({values})
WHEN NOT MATCHED BY SOURCE THEN DELETE"""


def load_app_state(endpoint: str, database: str, app_schema: str) -> tuple[int, int, int]:
    """Read the app's decisions straight from Lakebase and expose them as temporary views. Returns the counts of
    approved products, active edits and manual evidence."""
    from databricks.sdk.runtime import spark
    from pyspark.sql.types import LongType, StringType, StructField, StructType, TimestampType

    schema = f'"{_identifier(app_schema)}"'
    with connect(endpoint, database) as connection:
        reviews = connection.execute(
            f"SELECT product_ean, status, updated_by, updated_at, notes, "
            f"{run_column(connection, app_schema, 'product_review')} FROM {schema}.product_review "
            "WHERE status IN ('APPROVED', 'IN_REVIEW')"
        ).fetchall()
        overrides = connection.execute(
            f"SELECT id, product_ean, attribute_code, value, created_at FROM {schema}.attribute_override WHERE active"
        ).fetchall()
        exists = table_exists(connection, app_schema, "attribute_evidence")
        evidence = (
            connection.execute(
                f"SELECT product_ean, attribute_code, override_id, source_url, excerpt, screenshot_path, "
                f"{run_column(connection, app_schema, 'attribute_evidence')}, created_at "
                f"FROM {schema}.attribute_evidence WHERE active"
            ).fetchall()
            if exists
            else []  # the app creates the table on start; older deployments have no manual evidence yet
        )
    string, timestamp = StringType(), TimestampType()
    review_schema = StructType(
        [
            StructField("product_ean", string),
            StructField("status", string),
            StructField("updated_by", string),
            StructField("updated_at", timestamp),
            StructField("notes", string),
            StructField("run_id", string),
        ]
    )
    override_schema = StructType(
        [
            StructField("id", LongType()),
            StructField("product_ean", string),
            StructField("attribute_code", string),
            StructField("value", string),
            StructField("created_at", timestamp),
        ]
    )
    evidence_schema = StructType(
        [
            StructField("product_ean", string),
            StructField("attribute_code", string),
            StructField("override_id", LongType()),
            StructField("source_url", string),
            StructField("excerpt", string),
            StructField("screenshot_path", string),
            StructField("run_id", string),
            StructField("created_at", timestamp),
        ]
    )
    review_rows = [(r[0], r[1], r[2], naive_utc(r[3]), r[4], r[5]) for r in reviews]
    override_rows = [(r[0], r[1], r[2], r[3], naive_utc(r[4])) for r in overrides]
    evidence_rows = [(*r[:7], naive_utc(r[7])) for r in evidence]
    spark.createDataFrame(review_rows, schema=review_schema).createOrReplaceTempView(REVIEW_VIEW)
    spark.createDataFrame(override_rows, schema=override_schema).createOrReplaceTempView(OVERRIDE_VIEW)
    spark.createDataFrame(evidence_rows, schema=evidence_schema).createOrReplaceTempView(MANUAL_EVIDENCE_VIEW)
    approved = sum(1 for row in review_rows if row[1] == "APPROVED")
    return approved, len(override_rows), len(evidence_rows)


def publication_plan(namespace: str, destination_table: str) -> str:
    """Counts of what the MERGE will do, read before it runs (over the same temporary views)."""
    destination = _qualified_table(destination_table)
    return f"""
WITH {_approved_ctes(namespace)},
published AS (SELECT gtin AS ean FROM {destination})
SELECT
  (SELECT COUNT(*) FROM approved) AS approved,
  (SELECT COUNT(*) FROM latest) AS publishable,
  (SELECT COUNT(*) FROM approved a LEFT ANTI JOIN latest l ON l.ean = a.ean
     JOIN published p ON p.ean = a.ean) AS kept,
  (SELECT COUNT(*) FROM approved a LEFT ANTI JOIN latest l ON l.ean = a.ean
     LEFT ANTI JOIN published p ON p.ean = a.ean) AS waiting,
  (SELECT COUNT(*) FROM reopened r JOIN published p ON p.ean = r.ean) AS reopened,
  (SELECT COUNT(*) FROM published p LEFT ANTI JOIN approved a ON a.ean = p.ean
     LEFT ANTI JOIN reopened r ON r.ean = p.ean) AS removed,
  (SELECT COUNT(*) FROM published) AS published"""


def check_plan(approved: int, published: int, reopened: int = 0) -> None:
    """Fail closed instead of emptying the destination when the app state reads as no approval at all."""
    if approved == 0 and reopened == 0 and published > 0:
        raise RuntimeError(
            f"The app has no APPROVED product but the destination has {published} published products; refusing to "
            "delete them. Check lakebase_schema and the app's product_review table. To unpublish everything on "
            "purpose, delete the rows of the destination table directly."
        )


def run(
    *,
    catalog: str,
    schema: str,
    endpoint: str,
    database: str = "databricks_postgres",
    lakebase_schema: str = "brickfill_app",
    destination_table: str,
) -> None:
    """Publish the products approved in the app (Lakebase) to the destination Delta table."""
    from databricks.sdk.runtime import spark

    namespace = f"`{_identifier(catalog)}`.`{_identifier(schema)}`"
    spark.sql(destination_ddl(destination_table))
    approved, overrides, evidence = load_app_state(endpoint, database, lakebase_schema)
    plan = spark.sql(publication_plan(namespace, destination_table)).first()
    check_plan(plan["approved"], plan["published"], plan["reopened"])
    spark.sql(merge_statement(namespace, destination_table))
    published = spark.table(_qualified_table(destination_table)).count()
    print(
        f"{approved} products approved in the app ({overrides} active edits, {evidence} manual evidence): "
        f"{plan['publishable']} published from their approved result, {plan['removed']} rejected or pending removed; "
        f"{published} rows in {destination_table}"
    )
    unverified = spark.sql(
        f"SELECT COUNT(*) AS n FROM {_qualified_table(destination_table)} "
        'WHERE attributes_json LIKE \'%"source":"HUMAN_NO_EVIDENCE"%\''
    ).first()["n"]
    if unverified:
        print(f"WARNING: {unverified} published products have edits without evidence (source HUMAN_NO_EVIDENCE)")
    if plan["kept"]:
        print(
            f"WARNING: {plan['kept']} approved products have no publishable result (enriched again after the "
            "approval, a failed run, or no catalog row); their last published version was kept. Review them again "
            "in the app to publish the current result"
        )
    if plan["reopened"]:
        print(
            f"WARNING: {plan['reopened']} published products were changed after their approval (review IN_REVIEW); "
            "their last approved version was kept until a reviewer approves them again"
        )
    if plan["waiting"]:
        print(
            f"WARNING: {plan['waiting']} approved products have no publishable result and were never published; "
            "review them again in the app"
        )
