from __future__ import annotations

from typing import Any


def firecrawl_api_key(dbutils: Any, *, catalog: str, schema: str, key: str) -> str:
    """Read the Firecrawl key from the Unity Catalog secret catalog.schema.key."""
    if not (catalog.strip() and schema.strip() and key.strip()):
        raise ValueError("secret_catalog, secret_schema and firecrawl_secret_key are required")
    return dbutils.secrets.get(catalog=catalog.strip(), schema=schema.strip(), key=key.strip())
