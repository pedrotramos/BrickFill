"""Enrichment settings: job parameters overridden by what the team saves on the app's Settings screen.

The app stores them in Lakebase (``<app schema>.app_settings`` and ``<app schema>.category_settings``); the job reads
them once per batch and resolves, field by field, for each product:

    subcategory > category > department > app_settings > job parameters

on top of the content profile file. ``market`` and ``catalog_language`` are global (app_settings or job parameters).
Overrides (flat keys of ``content.loader.OVERRIDE_SPECS``) are merged key by key in the same order.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from brickfill.content.loader import (
    available_languages,
    available_markets,
    available_profiles,
    validate_overrides,
)
from brickfill.identifiers import pg_identifier
from brickfill.lakebase import table_exists

SCOPES = ("department", "category", "subcategory")  # lowest to highest precedence
SCOPED_FIELDS = ("content_language", "content_profile")
GLOBAL_FIELDS = ("content_language", "catalog_language", "content_profile", "market")


@dataclass(frozen=True)
class JobDefaults:
    content_language: str = "en"
    catalog_language: str = ""  # empty: same as content_language
    content_profile: str = "default"
    market: str = ""

    def as_dict(self) -> dict[str, str]:
        return {name: getattr(self, name) for name in GLOBAL_FIELDS}


@dataclass(frozen=True)
class SettingsSnapshot:
    """What the app had saved when the batch started (``source`` is ``lakebase`` or ``job_parameters``)."""

    app: dict[str, Any] | None = None
    scopes: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    source: str = "job_parameters"
    read_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "read_at": self.read_at,
            "app": self.app,
            "scopes": [
                {"scope": scope, "scope_id": scope_id, **value} for (scope, scope_id), value in self.scopes.items()
            ],
        }


@dataclass(frozen=True)
class EffectiveSettings:
    content_language: str
    catalog_language: str
    content_profile: str
    market: str
    overrides: dict[str, Any]
    provenance: dict[str, str]

    @property
    def key(self) -> tuple[str, str, str, str, str]:
        """Identity of the rules combination (one cached prompt per key)."""
        return (
            self.content_language,
            self.catalog_language,
            self.content_profile,
            self.market,
            json.dumps(self.overrides, sort_keys=True),
        )

    @property
    def hash(self) -> str:
        return hashlib.sha256(json.dumps(self.key).encode()).hexdigest()[:16]

    def as_dict(self) -> dict[str, Any]:
        return {
            "content_language": self.content_language,
            "catalog_language": self.catalog_language,
            "content_profile": self.content_profile,
            "market": self.market,
            "overrides": self.overrides,
            "provenance": self.provenance,
        }


def _json(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else {}
    if not isinstance(value, dict):
        raise TypeError("Settings overrides must be a JSON object")
    return value


def read_settings(connection: Any, app_schema: str) -> SettingsSnapshot:
    """Read the app's settings; missing tables (the app never started) mean "use the job parameters"."""
    has_app = table_exists(connection, app_schema, "app_settings")
    has_scopes = table_exists(connection, app_schema, "category_settings")
    if not has_app and not has_scopes:
        return SettingsSnapshot()
    schema = pg_identifier(app_schema)
    app = None
    if has_app:
        row = connection.execute(
            f"SELECT content_language, catalog_language, content_profile, market, overrides, version "
            f"FROM {schema}.app_settings WHERE id = 1"
        ).fetchone()
        if row:
            app = {
                "content_language": row[0],
                "catalog_language": row[1],
                "content_profile": row[2],
                "market": row[3],
                "overrides": _json(row[4]),
                "version": row[5],
            }
    scopes: dict[tuple[str, str], dict[str, Any]] = {}
    if has_scopes:
        rows = connection.execute(
            f"SELECT scope, scope_id, content_language, content_profile, overrides, version "
            f"FROM {schema}.category_settings WHERE active"
        ).fetchall()
        for row in rows:
            scopes[(row[0], str(row[1]))] = {
                "content_language": row[2],
                "content_profile": row[3],
                "overrides": _json(row[4]),
                "version": row[5],
            }
    return SettingsSnapshot(app=app, scopes=scopes, source="lakebase")


def _check(name: str, value: str, available: list[str]) -> str:
    if value not in available:
        raise ValueError(f"Unknown {name} {value!r} in the enrichment settings; available: {', '.join(available)}")
    return value


def resolve(snapshot: SettingsSnapshot, defaults: JobDefaults, seed: Any) -> EffectiveSettings:
    """Settings of one product (``ProductSeed``), with the origin of every field in ``provenance``."""
    values: dict[str, str] = {}
    provenance: dict[str, str] = {}
    for name in GLOBAL_FIELDS:
        if getattr(defaults, name):
            values[name], provenance[name] = getattr(defaults, name), "job"
    overrides: dict[str, Any] = {}
    layers: list[tuple[str, dict[str, Any], tuple[str, ...]]] = []
    if snapshot.app:
        layers.append(("app", snapshot.app, GLOBAL_FIELDS))
    for scope in SCOPES:
        scope_id = getattr(seed, f"{scope}_id", "")
        entry = snapshot.scopes.get((scope, str(scope_id))) if scope_id else None
        if entry:
            layers.append((f"{scope}:{scope_id}", entry, SCOPED_FIELDS))
    for origin, layer, fields in layers:
        for name in fields:
            if layer.get(name):
                values[name], provenance[name] = layer[name], origin
        for key, value in validate_overrides(layer.get("overrides")).items():
            overrides[key] = value
            provenance[f"overrides.{key}"] = origin

    content_language = _check("language", values.get("content_language", "en"), available_languages())
    catalog_language = values.get("catalog_language") or content_language
    if "catalog_language" not in provenance:
        provenance["catalog_language"] = provenance.get("content_language", "default")
    return EffectiveSettings(
        content_language=content_language,
        catalog_language=_check("language", catalog_language, available_languages()),
        content_profile=_check("content profile", values.get("content_profile", "default"), available_profiles()),
        market=_check("market", values["market"].upper(), available_markets()) if values.get("market") else "",
        overrides=overrides,
        provenance=provenance,
    )
