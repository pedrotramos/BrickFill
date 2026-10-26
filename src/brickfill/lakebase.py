"""Lakebase (Postgres) connection and the reads the jobs make from the app's schema.

The app owns its schema (``LAKEBASE_APP_SCHEMA``, default ``brickfill_app``): reviews, edits, manual evidence, audit
and settings. The jobs only read it; every read tolerates tables the app has not created yet (first deploy).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, NamedTuple

from brickfill.identifiers import pg_identifier

REVIEWED_STATUSES = ("APPROVED", "REJECTED")


class Decision(NamedTuple):
    """A reviewer's decision (or a manual evidence) and the enrichment result it was made on."""

    run_id: str | None
    at: datetime | None


def naive_utc(value: datetime | None) -> datetime | None:
    """Lakebase returns aware timestamps and Spark naive UTC ones; compare them as naive UTC."""
    if value is not None and value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def decision_applies(decision: Decision, run_id: str | None, created_at: datetime | None) -> bool:
    """Whether a decision holds for the enrichment result ``run_id``: a decision is made on one result, and a new
    result (re-enrichment) needs a new one. Rows saved before the app recorded the run hold when they are not older
    than the result. The app's queries and the publication apply the same rule in SQL."""
    if run_id is None:
        return False
    if decision.run_id is not None:
        return decision.run_id == run_id
    at, created = naive_utc(decision.at), naive_utc(created_at)
    return at is not None and created is not None and at >= created


def pending_reviews(latest: Mapping[str, Decision], closed: Mapping[str, Decision]) -> int:
    """Enriched products still waiting in the review queue: their latest result (``latest``, run and creation time)
    has no approval or rejection that holds for it. No review counts as pending, as in the app."""
    return sum(
        1
        for ean, result in latest.items()
        if not (ean in closed and decision_applies(closed[ean], result.run_id, result.at))
    )


def connect(endpoint: str, database: str) -> Any:
    """A psycopg connection to the Lakebase endpoint, authenticated with a short-lived database credential."""
    import psycopg  # imported late: only the Lakebase steps need the driver
    from databricks.sdk import WorkspaceClient

    if not endpoint:
        raise ValueError("lakebase_endpoint is required")
    workspace = WorkspaceClient()
    host = workspace.postgres.get_endpoint(name=endpoint).status.hosts.host
    token = workspace.postgres.generate_database_credential(endpoint=endpoint).token
    user = workspace.current_user.me().user_name
    return psycopg.connect(host=host, dbname=database, user=user, password=token, sslmode="require", autocommit=False)


def table_exists(connection: Any, schema: str, table: str) -> bool:
    return bool(
        connection.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
            (schema, table),
        ).fetchone()
    )


def columns_of(connection: Any, schema: str, table: str) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = %s",
            (schema, table),
        ).fetchall()
    }


def run_column(connection: Any, schema: str, table: str) -> str:
    """``run_id`` of an app table, or NULL while the app has not migrated it yet (it adds the column on start)."""
    return "run_id" if "run_id" in columns_of(connection, schema, table) else "CAST(NULL AS TEXT) AS run_id"


def closed_reviews_from(connection: Any, app_schema: str) -> dict[str, Decision]:
    """Approvals and rejections saved in the app, with the result each was made on. Empty before the app's first
    start."""
    if not table_exists(connection, app_schema, "product_review"):
        return {}
    rows = connection.execute(
        f"SELECT product_ean, {run_column(connection, app_schema, 'product_review')}, updated_at "
        f"FROM {pg_identifier(app_schema)}.product_review WHERE status = ANY(%s)",
        (list(REVIEWED_STATUSES),),
    ).fetchall()
    return {row[0]: Decision(row[1], row[2]) for row in rows}
