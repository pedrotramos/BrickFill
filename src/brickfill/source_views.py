"""Documented canonical views (``v_products``, ``v_attributes``, ``v_attribute_options``) over an adapter's SQL.

An adapter supplies only the body: one ``SELECT`` per view returning the canonical column names (any order; extra
columns are dropped). The framework wraps it with the column list, one ``COMMENT`` per column, the view comment, the
contract ``TBLPROPERTIES`` and a ``CAST`` per column that pins the contract types. Nullability, uniqueness and enums
cannot be declared on a view; ``contract_check`` enforces them.

Placeholders in the adapter SQL: ``{{source}}`` is the quoted ``adapter_source_catalog``.``adapter_source_schema``
and every key of the ``adapter_params`` JSON is available as ``{{key}}``; each value must be a plain identifier (or a
dotted path of identifiers), never free SQL.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from brickfill.contract import CONTRACT_VERSION, VIEWS, ViewContract, sql_string

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def quoted_namespace(catalog: str, schema: str) -> str:
    for part in (catalog, schema):
        if not _IDENTIFIER.fullmatch(part):
            raise ValueError(f"Invalid SQL identifier: {part!r}")
    return f"`{catalog}`.`{schema}`"


def _quoted_path(value: str) -> str:
    parts = value.replace("`", "").split(".")
    if not all(_IDENTIFIER.fullmatch(part) for part in parts):
        raise ValueError(f"Adapter parameter must be an identifier or a dotted path of identifiers: {value!r}")
    return ".".join(f"`{part}`" for part in parts)


def parse_adapter_params(value: str | dict[str, str] | None) -> dict[str, str]:
    params = json.loads(value) if isinstance(value, str) and value.strip() else (value or {})
    if not isinstance(params, dict) or not all(isinstance(item, str) for item in params.values()):
        raise ValueError("adapter_params must be a JSON object of string values")
    return params


def load_adapter(adapters_dir: str | Path, name: str) -> dict[str, str]:
    """The three SELECT bodies of ``adapters/<name>/``, keyed by view (``products``, ``attributes``, ...)."""
    if not _IDENTIFIER.fullmatch(name) or name.startswith("_"):
        raise ValueError(f"Invalid adapter name: {name!r}")
    directory = Path(adapters_dir) / name
    if not directory.is_dir():
        available = sorted(path.name for path in Path(adapters_dir).iterdir() if path.is_dir() and path.name[0] != "_")
        raise ValueError(f"Adapter {name!r} not found in {adapters_dir}; available: {', '.join(available)}")
    bodies: dict[str, str] = {}
    for contract in VIEWS:
        path = directory / f"{contract.key}.sql"
        if not path.is_file():
            raise ValueError(f"Adapter {name!r} has no {contract.key}.sql")
        bodies[contract.key] = path.read_text(encoding="utf-8")
    return bodies


def render(sql: str, source_namespace: str, params: dict[str, str] | None = None) -> str:
    """Substitute the placeholders of an adapter body; an unknown placeholder fails instead of reaching Spark."""
    values = {name: _quoted_path(value) for name, value in (params or {}).items()}
    values["source"] = source_namespace

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            raise ValueError(f"Unknown adapter placeholder {{{{{name}}}}}; pass it in adapter_params")
        return values[name]

    body = _PLACEHOLDER.sub(replace, sql).strip().rstrip(";").strip()
    if ";" in _strip_comments_and_strings(body):
        raise ValueError("An adapter file must hold a single SELECT statement")
    return body


def _strip_comments_and_strings(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return re.sub(r"'(?:[^'\\]|\\.)*'", "''", sql)


def view_statement(contract: ViewContract, body: str, target_namespace: str, adapter: str) -> str:
    """CREATE OR REPLACE VIEW with the contract's column comments, view comment, properties and casts."""
    column_list = ",\n  ".join(
        f"{column.name} COMMENT {sql_string(column.documented_comment())}" for column in contract.columns
    )
    selected = ",\n       ".join(
        f"CAST(src.{column.name} AS {column.type}) AS {column.name}" for column in contract.columns
    )
    properties = ", ".join(
        f"{sql_string(key)} = {sql_string(value)}"
        for key, value in (
            ("brickfill.contract", contract.key),
            ("brickfill.contract_version", CONTRACT_VERSION),
            ("brickfill.adapter", adapter),
        )
    )
    # The adapter body is indented under the outer SELECT; its own comments stay readable in the view definition.
    indented = "\n".join(f"  {line}" if line else line for line in body.splitlines())
    return (
        f"CREATE OR REPLACE VIEW {target_namespace}.`{contract.default_name}` (\n  {column_list}\n)\n"
        f"COMMENT {sql_string(contract.comment)}\n"
        f"TBLPROPERTIES ({properties})\n"
        f"AS SELECT {selected}\nFROM (\n{indented}\n) AS src"
    )


def view_statements(
    adapters_dir: str | Path,
    adapter: str,
    source_namespace: str,
    target_namespace: str,
    params: dict[str, str] | None = None,
) -> list[str]:
    """The three CREATE VIEW statements of an adapter; both namespaces are already-quoted ``catalog.schema`` pairs."""
    bodies = load_adapter(adapters_dir, adapter)
    return [
        view_statement(contract, render(bodies[contract.key], source_namespace, params), target_namespace, adapter)
        for contract in VIEWS
    ]
