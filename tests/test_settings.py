from __future__ import annotations

import pytest

from brickfill.models import ProductSeed
from brickfill.settings import JobDefaults, SettingsSnapshot, read_settings, resolve

SEED = ProductSeed(
    source_title="Drill",
    ean="7891234567895",
    category="Tools",
    subcategory="Drills",
    department_id="10",
    category_id="64",
    subcategory_id="564",
)


def test_job_defaults_only():
    settings = resolve(SettingsSnapshot(), JobDefaults("pt-BR", "", "default", "br"), SEED)
    assert (settings.content_language, settings.catalog_language, settings.market) == ("pt-BR", "pt-BR", "BR")
    assert settings.provenance["content_language"] == "job"


def test_field_by_field_precedence():
    snapshot = SettingsSnapshot(
        app={"content_language": "es", "catalog_language": "en", "content_profile": "default", "market": "MX",
             "overrides": {"title_max_length": 120, "faq_enabled": False}},
        scopes={
            ("department", "10"): {"content_language": "en", "overrides": {"title_max_length": 100}},
            ("category", "64"): {"content_language": "pt-BR", "content_profile": None, "overrides": {}},
            ("category", "99"): {"content_language": "en", "overrides": {}},
        },
        source="lakebase",
    )  # fmt: skip
    settings = resolve(snapshot, JobDefaults(), SEED)
    assert settings.content_language == "pt-BR"
    assert settings.provenance["content_language"] == "category:64"
    assert (settings.catalog_language, settings.market) == ("en", "MX")
    assert settings.overrides == {"title_max_length": 100, "faq_enabled": False}
    assert settings.provenance["overrides.title_max_length"] == "department:10"
    assert settings.provenance["overrides.faq_enabled"] == "app"
    other = resolve(snapshot, JobDefaults(), SEED.model_copy(update={"category_id": "1", "department_id": ""}))
    assert other.content_language == "es"
    assert settings.hash != other.hash


def test_unknown_codes_are_rejected():
    with pytest.raises(ValueError, match="language"):
        resolve(SettingsSnapshot(app={"content_language": "fr"}), JobDefaults(), SEED)
    with pytest.raises(ValueError, match="market"):
        resolve(SettingsSnapshot(), JobDefaults(market="XX"), SEED)
    with pytest.raises(ValueError, match="override"):
        resolve(SettingsSnapshot(app={"overrides": {"nope": 1}}), JobDefaults(), SEED)


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, tables, app_row=None, scope_rows=()):
        self.tables, self.app_row, self.scope_rows = tables, app_row, list(scope_rows)

    def execute(self, sql, params=None):
        if "information_schema" in sql:
            return _Result([(1,)] if params[1] in self.tables else [])
        if "app_settings" in sql:
            return _Result([self.app_row] if self.app_row else [])
        return _Result(self.scope_rows)


def test_missing_tables_fall_back_to_job_parameters():
    snapshot = read_settings(FakeConnection(set()), "brickfill_app")
    assert snapshot.source == "job_parameters" and snapshot.app is None


def test_read_settings_parses_rows():
    connection = FakeConnection(
        {"app_settings", "category_settings"},
        app_row=("es", None, "default", None, '{"faq_enabled": false}', 3),
        scope_rows=[("category", 64, "pt-BR", None, {}, 1)],
    )
    snapshot = read_settings(connection, "brickfill_app")
    assert snapshot.app["overrides"] == {"faq_enabled": False}
    assert snapshot.scopes[("category", "64")]["content_language"] == "pt-BR"
    assert resolve(snapshot, JobDefaults(), SEED).content_language == "pt-BR"
