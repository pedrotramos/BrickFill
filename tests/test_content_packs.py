from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from brickfill.content.loader import (
    OVERRIDE_SPECS,
    apply_overrides,
    available_languages,
    available_markets,
    available_profiles,
    load_locale,
    load_market,
    load_profile,
    profile_defaults,
    validate_overrides,
)
from brickfill.content.models import FACT_LABEL_KEYS, SECTION_KEYS

ROOT = Path(__file__).resolve().parents[1]


def test_languages_profiles_markets():
    assert available_languages() == ["en", "es", "pt-BR"]
    assert available_markets() == ["BR", "ES", "MX", "US"]
    assert "default" in available_profiles()
    for code in available_markets():
        assert load_market(code).code == code


def test_locale_packs_have_the_same_keys():
    packs = [load_locale(code) for code in available_languages()]
    for pack in packs:
        assert set(pack.fact_sheet_sections) == set(SECTION_KEYS), pack.code
        assert set(pack.fact_labels) == set(FACT_LABEL_KEYS), pack.code
        assert pack.promotional_terms and pack.generic_values and pack.packaging_terms.logistic


def test_profiles_reference_known_keys():
    for profile_id in available_profiles():
        profile = load_profile(profile_id)
        assert set(profile.fact_sheet.sections) <= set(SECTION_KEYS)
        assert set(profile.fact_sheet.must_include) <= set(FACT_LABEL_KEYS)
        for rule in profile.category_rules:
            assert set(rule.required_fact_labels) <= set(FACT_LABEL_KEYS)


def test_default_profile_is_neutral():
    profile = load_profile("default")
    assert profile.meta_description.required_suffixes == []
    assert profile.category_rules == []


def test_overrides_round_trip():
    defaults = profile_defaults(load_profile())
    assert set(defaults) == set(OVERRIDE_SPECS)
    changed = apply_overrides(load_profile(), {"title_max_length": 90, "faq_enabled": False, "units": "imperial"})
    assert (changed.title.max_length, changed.faq.enabled, changed.units) == (90, False, "imperial")
    for bad in ({"title_max_length": 5}, {"units": "nautical"}, {"unknown": 1}, {"faq_enabled": "yes"}):
        try:
            validate_overrides(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_manifest_is_current_and_matches_the_app_contract():
    spec = importlib.util.spec_from_file_location(
        "export_content_manifest", ROOT / "scripts/export_content_manifest.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = ROOT / "app" / "brickfill" / "config" / "content-manifest.json"
    assert path.read_text(encoding="utf-8") == module.render()
    manifest = json.loads(path.read_text(encoding="utf-8"))
    assert [item["code"] for item in manifest["languages"]] == ["en", "pt-BR", "es"]
    assert set(manifest) == {"contract_version", "languages", "profiles", "markets", "overrides", "profile_defaults"}
    assert set(manifest["profile_defaults"]["default"]) == set(manifest["overrides"])


def test_every_issue_and_reason_code_is_translated_in_the_app():
    from brickfill.issues import APPLICABILITY_REASONS, REJECTION_REASONS, TEMPLATES

    locales = ROOT / "app" / "brickfill" / "client" / "src" / "i18n" / "locales"
    for language in ("en", "pt-BR", "es"):
        issues = json.loads((locales / language / "issues.json").read_text(encoding="utf-8"))["codes"]
        product = json.loads((locales / language / "product.json").read_text(encoding="utf-8"))["attributes"]
        assert set(TEMPLATES) - set(issues) == set(), language
        assert set(REJECTION_REASONS) - set(product["rejection"]) == set(), language
        assert set(APPLICABILITY_REASONS) - set(product["applicability"]) == set(), language
