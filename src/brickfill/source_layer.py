"""Spark side of the source layer: mock ERP tables (dev), the canonical views and the contract checks."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from databricks.sdk.runtime import spark
from pyspark.sql.types import (
    BooleanType,
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from brickfill.contract import VIEWS
from brickfill.contract_check import data_checks, schema_issues, should_fail
from brickfill.identifiers import identifier
from brickfill.mock_data import generate
from brickfill.source_views import parse_adapter_params, quoted_namespace, view_statements

_SPARK_TYPES = {"string": StringType(), "int": IntegerType(), "bigint": LongType(), "boolean": BooleanType()}


def _namespace(catalog: str, schema: str) -> str:
    return f"`{identifier(catalog)}`.`{identifier(schema)}`"


def write_mock_tables(catalog: str, schema: str, product_count: int = 20_000, seed: int = 20260101) -> None:
    """Write the mock ERP tables (development data only; deliberately not in the canonical shape)."""
    namespace = _namespace(catalog, schema)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {namespace}")
    for table, (columns, rows) in generate(product_count, seed).items():
        struct = StructType([StructField(name, _SPARK_TYPES[kind], True) for name, kind in columns])
        data: list[Any] = rows
        spark.createDataFrame(data, schema=struct).write.mode("overwrite").option(
            "overwriteSchema", "true"
        ).saveAsTable(f"{namespace}.`{table}`")
        print(f"{namespace}.{table}: {len(rows)} rows")


def create_source_views(
    adapters_dir: str | Path,
    adapter: str,
    adapter_source_catalog: str,
    adapter_source_schema: str,
    catalog: str,
    schema: str,
    adapter_params: str | dict[str, str] | None = None,
) -> list[str]:
    """Create (or replace) the three documented canonical views from an adapter; returns the statements run."""
    target = _namespace(catalog, schema)
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {target}")
    statements = view_statements(
        adapters_dir,
        adapter,
        quoted_namespace(adapter_source_catalog, adapter_source_schema),
        target,
        parse_adapter_params(adapter_params),
    )
    for statement in statements:
        spark.sql(statement)
    print(f"Canonical views created in {target} from adapter {adapter!r}")
    return statements


def run_contract_checks(catalog: str, schema: str, adapter: str, results_table: str = "contract_check") -> list[dict]:
    """Validate the canonical views; every result is appended to ``<catalog>.<schema>.contract_check``."""
    namespace = _namespace(catalog, schema)
    checked_at = datetime.now(UTC).replace(tzinfo=None)
    results: list[dict[str, Any]] = []
    schema_ok = True
    for contract in VIEWS:
        table = f"{namespace}.`{contract.default_name}`"
        described = [(item.name, item.dataType.simpleString()) for item in spark.table(table).schema]
        for issue in schema_issues(contract, described):
            schema_ok = False
            results.append(
                {
                    "view": issue.view,
                    "code": issue.code,
                    "severity": "ERROR",
                    "description": f"{issue.column}: {issue.detail}",
                    "failing_rows": 1,
                    "sample_json": json.dumps([issue.column]),
                }
            )
    if schema_ok:  # data checks need every column
        for check in data_checks(namespace):
            row = spark.sql(check.sql).first()
            results.append(
                {
                    "view": check.view,
                    "code": check.code,
                    "severity": check.severity,
                    "description": check.description,
                    "failing_rows": int(row["failing_rows"]),
                    "sample_json": json.dumps(list(row["sample"] or []), ensure_ascii=False),
                }
            )
    struct = StructType(
        [
            StructField("checked_at", TimestampType(), False),
            StructField("adapter", StringType(), True),
            StructField("view", StringType(), False),
            StructField("code", StringType(), False),
            StructField("severity", StringType(), False),
            StructField("description", StringType(), True),
            StructField("failing_rows", LongType(), False),
            StructField("sample_json", StringType(), True),
        ]
    )
    rows = [{"checked_at": checked_at, "adapter": adapter, **result} for result in results]
    spark.createDataFrame(rows, schema=struct).write.mode("append").saveAsTable(
        f"{namespace}.`{identifier(results_table)}`"
    )
    return results


def check_contract(catalog: str, schema: str, adapter: str, fail_on: str = "error") -> list[dict]:
    """Run the checks, print a summary and fail the task according to ``fail_on`` (error, warning or never)."""
    results = run_contract_checks(catalog, schema, adapter)
    for result in results:
        mark = "ok" if result["failing_rows"] == 0 else f"{result['failing_rows']} rows"
        print(f"[{result['severity']}] {result['view']} {result['code']}: {mark} — {result['description']}")
    if should_fail(results, fail_on):
        failing = [f"{r['view']}.{r['code']}" for r in results if r["failing_rows"] and r["severity"] == "ERROR"]
        raise RuntimeError(
            "The canonical views break the BrickFill contract: "
            + ", ".join(failing or ["warnings (contract_fail_on=warning)"])
            + ". Fix the adapter (see adapters/README.md) or rerun with contract_fail_on=never."
        )
    return results
