"""Replay the crop step of a past run from its archived text maps: no Firecrawl request, no credits.

For every evidence of a product, reads the text map stored in the evidence Volume (``coordinates_path``) and runs the
current matching code on it, so a change to ``visual_evidence`` can be checked against real pages before it is paid
for:

    uv run python scripts/replay_capture.py --profile <PROFILE> --catalog <catalog> --ean <gtin> [--run-id <run>]

It reads ``<catalog>.<schema>.product_attribute_evidence`` through a SQL warehouse (``--warehouse-id``, else the first
one available) and prints, per evidence, the stored status, the value the crop looks for and what the current code
finds: a unique block (MATCH), several (AMBIGUOUS), none (NO_MATCH), or a value absent from the visible text map
(NOT_IN_MAP, e.g. a collapsed section).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import Disposition, Format, StatementParameterListItem

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from brickfill.visual_evidence import _contains, _quoted_blocks, _visible_excerpt, crop_value, table_cells

QUERY = """
SELECT attribute_name, capture_status, url, excerpt, fact_value, candidate_value, attribute_value, coordinates_path
FROM IDENTIFIER(:table)
WHERE ean = :ean AND run_id = COALESCE(NULLIF(:run_id, ''), (SELECT max_by(run_id, created_at) FROM IDENTIFIER(:enrichment)
                                               WHERE ean = :ean))
ORDER BY attribute_name
"""


def _warehouse(workspace: WorkspaceClient, warehouse_id: str | None) -> str:
    if warehouse_id:
        return warehouse_id
    for warehouse in workspace.warehouses.list():
        return warehouse.id
    raise SystemExit("No SQL warehouse available: pass --warehouse-id")


def _rows(workspace: WorkspaceClient, warehouse_id: str, table: str, args: argparse.Namespace) -> list[dict]:
    parameters = [
        StatementParameterListItem(name="table", value=f"{table}.product_attribute_evidence"),
        StatementParameterListItem(name="enrichment", value=f"{table}.product_enrichment"),
        StatementParameterListItem(name="ean", value=args.ean),
        StatementParameterListItem(name="run_id", value=args.run_id or ""),
    ]
    response = workspace.statement_execution.execute_statement(
        statement=QUERY,
        warehouse_id=warehouse_id,
        parameters=parameters,
        wait_timeout="50s",
        disposition=Disposition.INLINE,
        format=Format.JSON_ARRAY,
    )
    if response.status.error:
        raise SystemExit(response.status.error.message)
    columns = [column.name for column in response.manifest.schema.columns]
    return [dict(zip(columns, row)) for row in (response.result.data_array or [])]


def _geometry(workspace: WorkspaceClient, path: str) -> dict:
    return json.loads(workspace.files.download(path).contents.read())


def replay(row: dict, geometry: dict) -> tuple[str, str]:
    value = crop_value(row["excerpt"], row["fact_value"], row["candidate_value"], row["attribute_value"])
    if not any(_contains(block.get("context", ""), value) for block in geometry.get("blocks", [])):
        return "NOT_IN_MAP", value
    boxes = _quoted_blocks(geometry, _visible_excerpt(row["excerpt"] or ""), value, table_cells(row["excerpt"]))
    return ("MATCH" if len(boxes) == 1 else "AMBIGUOUS" if boxes else "NO_MATCH"), value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--profile", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--schema", default="brickfill")
    parser.add_argument("--ean", required=True)
    parser.add_argument("--run-id")
    parser.add_argument("--warehouse-id")
    args = parser.parse_args()

    workspace = WorkspaceClient(profile=args.profile)
    table = f"`{args.catalog}`.`{args.schema}`"
    rows = _rows(workspace, _warehouse(workspace, args.warehouse_id), table, args)
    if not rows:
        raise SystemExit("No evidence found for this product and run")
    found: dict[str, int] = {}
    for row in rows:
        if not row["coordinates_path"]:
            outcome, value = "NO_CAPTURE", ""
        else:
            outcome, value = replay(row, _geometry(workspace, row["coordinates_path"]))
        found[outcome] = found.get(outcome, 0) + 1
        print(f"{row['capture_status']:>12} -> {outcome:<10} {row['attribute_name']}: looks for {value[:80]!r}")
    print("\n" + ", ".join(f"{outcome}: {count}" for outcome, count in sorted(found.items())))


if __name__ == "__main__":
    main()
