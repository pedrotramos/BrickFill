"""SQL identifier validation shared by the Spark and the Postgres steps (no runtime imports)."""

from __future__ import annotations

import re

_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"Invalid SQL identifier: {value!r}")
    return value


def qualified_table(value: str) -> str:
    """Validate a catalog.schema.table reference and return it with each part backtick-quoted."""
    parts = value.replace("`", "").split(".")
    if len(parts) != 3:
        raise ValueError(f"Expected catalog.schema.table, got {value!r}")
    return ".".join(f"`{identifier(part)}`" for part in parts)


def pg_identifier(value: str) -> str:
    """A validated, double-quoted Postgres identifier."""
    return f'"{identifier(value)}"'
