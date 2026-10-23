from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from databricks.sdk.runtime import spark
from pyspark.sql.types import BooleanType, IntegerType, StringType, StructField, StructType

from brickfill.contract import ATTRIBUTE_OPTIONS, ATTRIBUTES, PRODUCTS, ViewContract
from brickfill.contract_check import schema_issues
from brickfill.identifiers import identifier as _identifier
from brickfill.identifiers import qualified_table as _qualified_table
from brickfill.normalize import normalize_sources
from brickfill.visual_evidence import EVIDENCE_COLUMNS

__all__ = ["_identifier", "_qualified_table", "initialize_output_tables", "run"]

PRODUCT_INPUT_COLUMNS = (
    "product_id",
    "ean",
    "source_title",
    "title_alt",
    "brand",
    "supplier",
    "department_id",
    "department",
    "category_id",
    "category",
    "subcategory_id",
    "subcategory",
)


def _check_schema(table: str, contract: ViewContract) -> None:
    """Fail fast when a source view drifted from the contract (missing column or wrong type)."""
    described = [(item.name, item.dataType.simpleString()) for item in spark.table(_qualified_table(table)).schema]
    issues = schema_issues(contract, described)
    if issues:
        details = "; ".join(f"{issue.column}: {issue.code} ({issue.detail})" for issue in issues)
        raise ValueError(f"{table} does not follow the BrickFill contract ({contract.default_name}): {details}")


def read_source_tables(
    products_table: str,
    attributes_table: str,
    attribute_options_table: str,
    *,
    attributes_required_default: bool,
):
    for table, contract in (
        (products_table, PRODUCTS),
        (attributes_table, ATTRIBUTES),
        (attribute_options_table, ATTRIBUTE_OPTIONS),
    ):
        _check_schema(table, contract)

    def rows(table: str) -> Iterable[dict[str, Any]]:
        return (row.asDict() for row in spark.table(_qualified_table(table)).toLocalIterator())

    return normalize_sources(
        rows(products_table),
        rows(attributes_table),
        rows(attribute_options_table),
        attributes_required_default=attributes_required_default,
    )


def _write_table(rows: list[dict[str, Any]], schema: StructType, table: str) -> None:
    spark.createDataFrame(rows, schema=schema).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(
        table
    )


# Columns added after the first release: ALTERed into existing tables, since CREATE TABLE IF NOT EXISTS keeps old ones.
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "enrichment_run": {"settings_json": "STRING"},
    "product_enrichment": {"content_language": "STRING", "content_profile": "STRING", "settings_hash": "STRING"},
    "product_attribute": {
        "candidate_value": "STRING",
        "normalized_value": "STRING",
        "mapping_status": "STRING",
        "source_fact_names_json": "STRING",
        "rejection_reason": "STRING",
        "applicability_reason": "STRING",
        "rejection_code": "STRING",
        "applicability_code": "STRING",
    },
    "validation_issue": {"params_json": "STRING"},
}


def _ensure_columns(table: str, columns: dict[str, str]) -> None:
    existing = {name.lower() for name in spark.table(table).schema.fieldNames()}
    missing = [f"{name} {kind}" for name, kind in columns.items() if name.lower() not in existing]
    if missing:
        spark.sql(f"ALTER TABLE {table} ADD COLUMNS ({', '.join(missing)})")


def initialize_output_tables(namespace: str) -> None:
    statements = [
        f"""CREATE TABLE IF NOT EXISTS {namespace}.product_attribute_evidence (
          {", ".join(f"{name} {kind}" for name, kind in EVIDENCE_COLUMNS.items())}
        ) USING DELTA""",
        f"""CREATE TABLE IF NOT EXISTS {namespace}.enrichment_run (
          run_id STRING, started_at TIMESTAMP, completed_at TIMESTAMP, model_endpoint STRING,
          prompt_version STRING, product_count BIGINT, success_count BIGINT, failure_count BIGINT, status STRING,
          settings_json STRING
        ) USING DELTA""",
        f"""CREATE TABLE IF NOT EXISTS {namespace}.product_enrichment (
          run_id STRING, ean STRING, generated_title STRING, short_description STRING,
          meta_description STRING, verified_brand STRING, model STRING, supplier STRING,
          quality_score DOUBLE, status STRING, result_json STRING, created_at TIMESTAMP,
          content_language STRING, content_profile STRING, settings_hash STRING
        ) USING DELTA""",
        f"""CREATE TABLE IF NOT EXISTS {namespace}.product_fact (
          run_id STRING, ean STRING, fact_name STRING, fact_value STRING, normalized_value STRING,
          confidence DOUBLE, evidence_json STRING, created_at TIMESTAMP
        ) USING DELTA""",
        f"""CREATE TABLE IF NOT EXISTS {namespace}.product_attribute (
          run_id STRING, ean STRING, attribute_code STRING, attribute_name STRING, attribute_value STRING,
          required BOOLEAN, applicable BOOLEAN, confidence DOUBLE, evidence_urls_json STRING,
          observation STRING, created_at TIMESTAMP, candidate_value STRING, normalized_value STRING,
          mapping_status STRING, source_fact_names_json STRING, rejection_reason STRING,
          applicability_reason STRING, rejection_code STRING, applicability_code STRING
        ) USING DELTA""",
        f"""CREATE TABLE IF NOT EXISTS {namespace}.validation_issue (
          run_id STRING, ean STRING, issue_code STRING, severity STRING, field STRING, message STRING,
          created_at TIMESTAMP, params_json STRING
        ) USING DELTA""",
    ]
    for statement in statements:
        spark.sql(statement)
    for table, columns in ADDED_COLUMNS.items():
        _ensure_columns(f"{namespace}.{table}", columns)


def _enrichment_ctes(namespace: str) -> str:
    return f"""WITH latest AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ean ORDER BY created_at DESC) AS row_number
          FROM {namespace}.product_enrichment
        ), issue_counts AS (
          SELECT run_id, ean,
                 SUM(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
                 SUM(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END) AS warning_count
          FROM {namespace}.validation_issue GROUP BY run_id, ean
        ), attribute_counts AS (
          SELECT run_id, ean,
                 SUM(CASE WHEN required AND applicable THEN 1 ELSE 0 END) AS required_count,
                 SUM(CASE WHEN required AND applicable AND attribute_value IS NOT NULL THEN 1 ELSE 0 END) AS filled_required_count
          FROM {namespace}.product_attribute GROUP BY run_id, ean
        )"""


def product_catalog_select(namespace: str) -> str:
    """One row per product with its latest enrichment, issues and coverage (view ``product_catalog``)."""
    return f"""
        {_enrichment_ctes(namespace)}
        SELECT p.ean, p.product_id, p.source_title, p.brand AS source_brand,
               p.department_id, p.department, p.category_id, p.category, p.subcategory_id, p.subcategory,
               l.run_id, l.generated_title, l.short_description, l.meta_description,
               l.verified_brand, l.model, l.supplier, l.quality_score,
               COALESCE(l.status, 'PENDING') AS status, l.result_json, l.created_at,
               l.content_language, l.content_profile, l.settings_hash,
               COALESCE(i.error_count, 0) AS error_count,
               COALESCE(i.warning_count, 0) AS warning_count,
               COALESCE(a.required_count, 0) AS required_count,
               COALESCE(a.filled_required_count, 0) AS filled_required_count,
               CASE WHEN COALESCE(a.required_count, 0) = 0 THEN 0.0
                    ELSE a.filled_required_count / a.required_count END AS required_coverage
        FROM {namespace}.product_input p
        LEFT JOIN latest l ON p.ean = l.ean AND l.row_number = 1
        LEFT JOIN issue_counts i ON l.run_id = i.run_id AND l.ean = i.ean
        LEFT JOIN attribute_counts a ON l.run_id = a.run_id AND l.ean = a.ean
        """


def enrichment_summary_select(namespace: str) -> str:
    """Latest enrichment result per EAN, only for enriched products (view ``enrichment_summary``).

    The app lists the full source catalog from the canonical views and overlays this summary, so listing never
    depends on ``product_input``.
    """
    return f"""
        {_enrichment_ctes(namespace)}
        SELECT l.ean, l.run_id, l.generated_title, l.verified_brand, l.quality_score,
               COALESCE(l.status, 'PENDING') AS status, l.created_at,
               l.content_language, l.content_profile,
               COALESCE(i.error_count, 0) AS error_count,
               COALESCE(i.warning_count, 0) AS warning_count,
               CASE WHEN COALESCE(a.required_count, 0) = 0 THEN 0.0
                    ELSE a.filled_required_count / a.required_count END AS required_coverage
        FROM latest l
        LEFT JOIN issue_counts i ON l.run_id = i.run_id AND l.ean = i.ean
        LEFT JOIN attribute_counts a ON l.run_id = a.run_id AND l.ean = a.ean
        WHERE l.row_number = 1
        """


def create_views(namespace: str) -> None:
    spark.sql(f"CREATE OR REPLACE VIEW {namespace}.product_catalog AS {product_catalog_select(namespace)}")
    spark.sql(f"CREATE OR REPLACE VIEW {namespace}.enrichment_summary AS {enrichment_summary_select(namespace)}")


def run(
    *,
    catalog: str,
    schema: str,
    products_table: str,
    attributes_table: str,
    attribute_options_table: str,
    attributes_required_default: bool = True,
) -> None:
    """Normalize the canonical views (products, attributes, attribute options) into the enrichment tables.

    ``attributes_required_default`` applies to the attributes whose ``is_required`` is NULL.
    """
    catalog, schema = _identifier(catalog), _identifier(schema)
    namespace = f"`{catalog}`.`{schema}`"
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
    products, attributes, answers, report = read_source_tables(
        products_table,
        attributes_table,
        attribute_options_table,
        attributes_required_default=attributes_required_default,
    )
    if not products:
        raise ValueError(f"No usable products (gtin, title and subcategory_id) found in {products_table}")

    string = StringType()
    _write_table(
        products,
        StructType([StructField(name, string, name not in {"ean", "source_title"}) for name in PRODUCT_INPUT_COLUMNS]),
        f"{namespace}.product_input",
    )
    _write_table(
        attributes,
        StructType(
            [
                StructField("subcategory_id", string, False),
                StructField("category_id", string, True),
                StructField("subcategory", string, True),
                StructField("attribute_code", string, False),
                StructField("attribute_name", string, False),
                StructField("attribute_description", string, True),
                StructField("required", BooleanType(), False),
                StructField("value_type", string, True),
                StructField("unit", string, True),
                StructField("attribute_role", string, True),
                StructField("allows_free_text", BooleanType(), False),
                StructField("sort_order", IntegerType(), True),
            ]
        ),
        f"{namespace}.attribute_definition",
    )
    _write_table(
        answers,
        StructType(
            [
                StructField("attribute_code", string, False),
                StructField("attribute_name", string, False),
                StructField("allowed_value", string, False),
                StructField("sort_order", IntegerType(), True),
            ]
        ),
        f"{namespace}.attribute_allowed_value",
    )
    initialize_output_tables(namespace)
    create_views(namespace)
    if report.duplicate_gtins:
        print(f"WARNING: duplicate GTINs kept once: {', '.join(report.duplicate_gtins[:20])}")
    print(f"Prepared {report.summary()}")
