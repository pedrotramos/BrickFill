"""Enrichment settings: job parameters overridden by what the team saves on the app's Settings screen.

The app stores them in Lakebase (``<app schema>.app_settings``, ``category_template`` and ``category_settings``); the
job reads them once per batch and resolves, field by field, for each product:

    subcategory > category > department > category template > app_settings > job parameters

on top of the content profile file. ``market`` and ``catalog_language`` are global (app_settings or job parameters).
Overrides (flat keys of ``content.loader.OVERRIDE_SPECS``) are merged key by key in the same order. A product gets the
most specific active template that matches it (subcategory > category > department, by id, name or synonym).

The same read brings the team's additional agent instructions (``agent_instruction_version``, the active one) and the
attribute requirement overrides (``attribute_requirement_override``, per subcategory and attribute).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from brickfill.content.loader import (
    available_languages,
    available_markets,
    available_profiles,
    validate_overrides,
)
from brickfill.content.models import CategoryMatch
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
    read_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    # Active category templates: {"id", "name", "revision", "match" (CategoryMatch fields), "overrides"}.
    templates: list[dict[str, Any]] = field(default_factory=list)
    # Active agent instructions: {"version", "body", "sha256"}; None when the team saved none.
    instructions: dict[str, Any] | None = None
    # (subcategory_id, attribute_code) -> required, as decided in the app (pairs following the source are absent).
    attribute_overrides: dict[tuple[str, str], bool] = field(default_factory=dict)

    @property
    def attribute_overrides_hash(self) -> str:
        items = sorted(f"{sub}|{code}|{int(value)}" for (sub, code), value in self.attribute_overrides.items())
        return hashlib.sha256("\n".join(items).encode()).hexdigest()[:16]

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "read_at": self.read_at,
            "app": self.app,
            "scopes": [
                {"scope": scope, "scope_id": scope_id, **value} for (scope, scope_id), value in self.scopes.items()
            ],
            "templates": self.templates,
            "instructions": self.instructions,
            "attribute_overrides": {
                "count": len(self.attribute_overrides),
                "hash": self.attribute_overrides_hash,
            },
        }


@dataclass(frozen=True)
class EffectiveSettings:
    content_language: str
    catalog_language: str
    content_profile: str
    market: str
    overrides: dict[str, Any]
    provenance: dict[str, str]
    # "<template id>@r<revision>" of the category template applied, "" for none.
    template: str = ""
    instructions_version: int | None = None
    instructions_sha256: str = ""

    @property
    def key(self) -> tuple[str, ...]:
        """Identity of the rules combination (one cached prompt per key)."""
        return (
            self.content_language,
            self.catalog_language,
            self.content_profile,
            self.market,
            json.dumps(self.overrides, sort_keys=True),
            self.template,
            self.instructions_sha256,
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
            "template": self.template,
            "instructions_version": self.instructions_version,
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
        return SettingsSnapshot()  # the app never started: none of its tables exist
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
    templates: list[dict[str, Any]] = []
    if table_exists(connection, app_schema, "category_template"):
        rows = connection.execute(
            f"SELECT id, name, revision, match, overrides FROM {schema}.category_template WHERE active ORDER BY id"
        ).fetchall()
        for row in rows:
            templates.append(
                {
                    "id": str(row[0]),
                    "name": row[1],
                    "revision": int(row[2]),
                    "match": CategoryMatch.model_validate(_json(row[3])).model_dump(),
                    "overrides": _json(row[4]),
                }
            )
    instructions = None
    if table_exists(connection, app_schema, "agent_instruction_version"):
        row = connection.execute(
            f"SELECT version, body FROM {schema}.agent_instruction_version WHERE active ORDER BY version DESC LIMIT 1"
        ).fetchone()
        if row and str(row[1] or "").strip():
            body = str(row[1]).strip()
            instructions = {
                "version": int(row[0]),
                "body": body,
                "sha256": hashlib.sha256(body.encode()).hexdigest(),
            }
    attribute_overrides: dict[tuple[str, str], bool] = {}
    if table_exists(connection, app_schema, "attribute_requirement_override"):
        rows = connection.execute(
            f"SELECT subcategory_id, attribute_id, required FROM {schema}.attribute_requirement_override "
            "WHERE required IS NOT NULL"
        ).fetchall()
        attribute_overrides = {(str(row[0]), str(row[1])): bool(row[2]) for row in rows}
    return SettingsSnapshot(
        app=app,
        scopes=scopes,
        source="lakebase",
        templates=templates,
        instructions=instructions,
        attribute_overrides=attribute_overrides,
    )


def matching_template(snapshot: SettingsSnapshot, seed: Any) -> dict[str, Any] | None:
    """The most specific active template for a product (subcategory > category > department); ties by id."""
    ranked = [
        (CategoryMatch.model_validate(template["match"]).level(seed), template["id"], template)
        for template in snapshot.templates
    ]
    ranked = [item for item in ranked if item[0] > 0]
    if not ranked:
        return None
    best = max(level for level, _id, _template in ranked)
    return min((item for item in ranked if item[0] == best), key=lambda item: item[1])[2]


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
    template = matching_template(snapshot, seed)
    template_key = f"{template['id']}@r{template['revision']}" if template else ""
    if template:
        layers.append((f"template:{template_key}", {"overrides": template["overrides"]}, ()))
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
        template=template_key,
        instructions_version=snapshot.instructions["version"] if snapshot.instructions else None,
        instructions_sha256=snapshot.instructions["sha256"] if snapshot.instructions else "",
    )


def required_flag(
    overrides: dict[tuple[str, str], bool], subcategory_id: str, code: str, required: bool, source_required: Any
) -> tuple[bool, str]:
    """Effective requirement of an attribute: the team's choice on the Attributes screen, else the source's
    ``is_required``, else ``attributes_required_default`` (already folded into ``required`` by the prepare step)."""
    override = overrides.get((str(subcategory_id), str(code)))
    if override is not None:
        return bool(override), "override"
    return bool(required), "default" if source_required is None else "source"
