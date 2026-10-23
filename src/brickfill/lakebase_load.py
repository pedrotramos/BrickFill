"""Copy the latest enrichment of every product from Delta into Lakebase, where the app reads it.

The enrichment job keeps writing Delta exactly as before (history, analytics, evidence). This step then loads
the *latest run of each product* into a Lakebase schema owned by the job, so the app can serve the catalog,
the product detail, attributes, facts and issues with Postgres latency. Human decisions (review, overrides,
audit, settings) stay in the app's own schema (``brickfill_app`` by default) and flow back to Delta through ``publish_approved``.

The load is idempotent and safe to repeat or run on its own (backfill): children rows are inserted under the
new ``run_id`` first, the ``product_enrichment`` row (the publication marker, like in Delta) is upserted last,
and only then are the superseded runs removed, so readers always see a consistent run.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Iterator, Sequence
from typing import Any

from brickfill.identifiers import identifier as _identifier
from brickfill.lakebase import connect

BATCH_ROWS = 2000

# Delta column -> Postgres type. Order is the column order of the INSERT statements.
ENRICHMENT_COLUMNS: dict[str, str] = {
    "ean": "TEXT PRIMARY KEY",
    "product_id": "TEXT",
    "source_title": "TEXT",
    "source_brand": "TEXT",
    "department_id": "TEXT",
    "department": "TEXT",
    "category_id": "TEXT",
    "category": "TEXT",
    "subcategory_id": "TEXT",
    "subcategory": "TEXT",
    "run_id": "TEXT NOT NULL",
    "generated_title": "TEXT",
    "short_description": "TEXT",
    "meta_description": "TEXT",
    "verified_brand": "TEXT",
    "model": "TEXT",
    "supplier": "TEXT",
    "quality_score": "DOUBLE PRECISION",
    "status": "TEXT NOT NULL",
    "result_json": "TEXT",
    "created_at": "TIMESTAMP",
    "content_language": "TEXT",
    "content_profile": "TEXT",
    "settings_hash": "TEXT",
    "error_count": "INT NOT NULL DEFAULT 0",
    "warning_count": "INT NOT NULL DEFAULT 0",
    "required_count": "INT NOT NULL DEFAULT 0",
    "filled_required_count": "INT NOT NULL DEFAULT 0",
    "required_coverage": "DOUBLE PRECISION",
}
ATTRIBUTE_COLUMNS: dict[str, str] = {
    "run_id": "TEXT NOT NULL",
    "ean": "TEXT NOT NULL",
    "row_id": "INT NOT NULL",
    "attribute_code": "TEXT NOT NULL",
    "attribute_name": "TEXT",
    "attribute_value": "TEXT",
    "required": "BOOLEAN",
    "applicable": "BOOLEAN",
    "confidence": "DOUBLE PRECISION",
    "evidence_urls_json": "TEXT",
    "observation": "TEXT",
    "created_at": "TIMESTAMP",
    "candidate_value": "TEXT",
    "normalized_value": "TEXT",
    "mapping_status": "TEXT",
    "source_fact_names_json": "TEXT",
    "rejection_reason": "TEXT",
    "applicability_reason": "TEXT",
    "rejection_code": "TEXT",
    "applicability_code": "TEXT",
}
FACT_COLUMNS: dict[str, str] = {
    "run_id": "TEXT NOT NULL",
    "ean": "TEXT NOT NULL",
    "row_id": "INT NOT NULL",
    "fact_name": "TEXT",
    "fact_value": "TEXT",
    "normalized_value": "TEXT",
    "confidence": "DOUBLE PRECISION",
    "evidence_json": "TEXT",
    "created_at": "TIMESTAMP",
}
ISSUE_COLUMNS: dict[str, str] = {
    "run_id": "TEXT NOT NULL",
    "ean": "TEXT NOT NULL",
    "row_id": "INT NOT NULL",
    "issue_code": "TEXT",
    "severity": "TEXT",
    "field": "TEXT",
    "message": "TEXT",
    "created_at": "TIMESTAMP",
    "params_json": "TEXT",
}
CHILD_TABLES: dict[str, dict[str, str]] = {
    "product_attribute": ATTRIBUTE_COLUMNS,
    "product_fact": FACT_COLUMNS,
    "validation_issue": ISSUE_COLUMNS,
}


def results_schema(name: str) -> str:
    return f'"{_identifier(name)}"'


def ddl_statements(schema: str) -> list[str]:
    """Idempotent DDL for the job-owned results schema; ``schema`` comes from :func:`results_schema`."""

    def table(name: str, columns: dict[str, str], extra: str = "") -> str:
        body = ", ".join(f"{column} {kind}" for column, kind in columns.items())
        return f"CREATE TABLE IF NOT EXISTS {schema}.{name} ({body}{extra})"

    def added_columns(name: str, columns: dict[str, str]) -> list[str]:
        # CREATE TABLE IF NOT EXISTS keeps tables created by older releases: add the columns they lack.
        return [
            f"ALTER TABLE {schema}.{name} ADD COLUMN IF NOT EXISTS {column} {kind}"
            for column, kind in columns.items()
            if "PRIMARY KEY" not in kind and "NOT NULL" not in kind
        ]

    return [
        f"CREATE SCHEMA IF NOT EXISTS {schema}",
        table("product_enrichment", {**ENRICHMENT_COLUMNS, "loaded_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()"}),
        *added_columns("product_enrichment", ENRICHMENT_COLUMNS),
        f"CREATE INDEX IF NOT EXISTS product_enrichment_status_idx ON {schema}.product_enrichment (status)",
        f"CREATE INDEX IF NOT EXISTS product_enrichment_category_idx ON {schema}.product_enrichment (category)",
        *[table(name, columns, ", PRIMARY KEY (ean, run_id, row_id)") for name, columns in CHILD_TABLES.items()],
        *[statement for name, columns in CHILD_TABLES.items() for statement in added_columns(name, columns)],
    ]


def upsert_statement(schema: str, table: str, columns: Sequence[str], conflict: Sequence[str]) -> str:
    names = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c not in conflict)
    # The marker row is replaced by the newest run; children are keyed by run_id, so a repeat is a no-op.
    action = f"DO UPDATE SET {updates}, loaded_at = NOW()" if table == "product_enrichment" else "DO NOTHING"
    return (
        f"INSERT INTO {schema}.{table} ({names}) VALUES ({placeholders}) ON CONFLICT ({', '.join(conflict)}) {action}"
    )


def purge_superseded_statements(schema: str) -> list[str]:
    """Remove children of runs that are no longer the product's published run."""
    return [
        f"DELETE FROM {schema}.{name} c USING {schema}.product_enrichment e "
        f"WHERE c.ean = e.ean AND c.run_id <> e.run_id"
        for name in CHILD_TABLES
    ]


def grant_statements(schema: str, role: str) -> list[str]:
    quoted = '"' + role.replace('"', '""') + '"'
    return [
        f"GRANT USAGE ON SCHEMA {schema} TO {quoted}",
        f"GRANT SELECT ON ALL TABLES IN SCHEMA {schema} TO {quoted}",
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT SELECT ON TABLES TO {quoted}",
    ]


def source_queries(namespace: str, run_id: str = "") -> dict[str, str]:
    """Spark SQL for the latest run of each enriched product, one statement per Lakebase table.

    With ``run_id``, only the products whose latest run is that one (the products the job has just enriched).
    """
    # validated as a UUID before it is placed in the SQL text
    latest = f"c.run_id = '{uuid.UUID(run_id)}'" if run_id else "c.run_id IS NOT NULL"

    def child(table: str, columns: Sequence[str], order: str) -> str:
        selected = ", ".join(f"t.{c}" for c in columns if c != "row_id")
        return (
            f"SELECT {selected}, ROW_NUMBER() OVER (PARTITION BY t.run_id, t.ean ORDER BY {order}) AS row_id "
            f"FROM {namespace}.{table} t JOIN {namespace}.product_catalog c ON t.run_id = c.run_id AND t.ean = c.ean "
            f"WHERE {latest} ORDER BY t.ean, row_id"
        )

    return {
        "product_enrichment": (
            f"SELECT {', '.join(ENRICHMENT_COLUMNS)} FROM {namespace}.product_catalog c WHERE {latest} ORDER BY ean"
        ),
        "product_attribute": child("product_attribute", list(ATTRIBUTE_COLUMNS), "t.attribute_code, t.attribute_name"),
        "product_fact": child("product_fact", list(FACT_COLUMNS), "t.fact_name, t.fact_value"),
        "validation_issue": child("validation_issue", list(ISSUE_COLUMNS), "t.issue_code, t.field, t.message"),
    }


def batches(rows: Iterable[Sequence[Any]], size: int = BATCH_ROWS) -> Iterator[list[Sequence[Any]]]:
    batch: list[Sequence[Any]] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def _load_table(connection, schema: str, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]) -> int:
    conflict = ["ean"] if table == "product_enrichment" else ["ean", "run_id", "row_id"]
    statement = upsert_statement(schema, table, columns, conflict)
    total = 0
    for batch in batches(rows):
        with connection.cursor() as cursor:
            cursor.executemany(statement, batch)
        connection.commit()
        total += len(batch)
    return total


def prepare_schema(connection, schema: str) -> None:
    """Create the job-owned results schema and tables if they do not exist."""
    for statement in ddl_statements(schema):
        connection.execute(statement)
    connection.commit()


def load_results(connection, namespace: str, schema: str, run_id: str = "") -> dict[str, int]:
    """Copy the latest run of every product (or only the products of ``run_id``). Children first, then the
    publication marker, then the cleanup."""
    from databricks.sdk.runtime import spark  # imported late: the SQL builders above are tested without Spark

    queries = source_queries(namespace, run_id)
    counts: dict[str, int] = {}
    for table in (*CHILD_TABLES, "product_enrichment"):
        columns = ENRICHMENT_COLUMNS if table == "product_enrichment" else CHILD_TABLES[table]
        rows = (tuple(row[c] for c in columns) for row in spark.sql(queries[table]).toLocalIterator())
        counts[table] = _load_table(connection, schema, table, list(columns), rows)
    for statement in purge_superseded_statements(schema):
        connection.execute(statement)
    connection.commit()
    return counts


def grant_app_read(connection, schema: str, app_role: str) -> None:
    """Best effort: the app role only exists once the app has been deployed."""
    try:
        for statement in grant_statements(schema, app_role):
            connection.execute(statement)
        connection.commit()
    except Exception as exc:  # noqa: BLE001
        connection.rollback()
        print(f"WARNING: could not grant read access to {app_role!r}: {exc}")


def run(
    *,
    catalog: str,
    schema: str,
    endpoint: str,
    database: str = "databricks_postgres",
    results_schema_name: str = "enrichment",
    app_role: str = "",
    scope: str = "all",
    run_id: str = "",
) -> dict[str, int]:
    """Load the latest enrichment of each product into Lakebase (the notebook runs these steps in separate cells).

    ``scope="all"`` copies every enriched product (repair, backfill); ``scope="run"`` copies only the products of
    ``run_id``, the run the enrichment job has just written, and nothing when that run enriched no product.
    """
    if scope not in ("all", "run"):
        raise ValueError(f'scope must be "all" or "run"; received {scope!r}')
    if scope == "run" and not run_id:
        print("The enrichment run enriched no product; nothing to load")
        return {}
    namespace = f"`{_identifier(catalog)}`.`{_identifier(schema)}`"
    target = results_schema(results_schema_name)
    with connect(endpoint, database) as connection:
        prepare_schema(connection, target)
        counts = load_results(connection, namespace, target, run_id if scope == "run" else "")
        if app_role:
            grant_app_read(connection, target, app_role)
    print(f"Loaded into Lakebase schema {target}: {counts}")
    return counts
