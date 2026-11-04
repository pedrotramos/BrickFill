"""Load content profiles, locale packs and market packs, apply overrides and build the effective rules.

``effective_rules`` is what the prompt, the post-processing and the validations read. Matching (aliases, generic
values, packaging terms, units, brand and taxonomy attribute names) uses the packs of both the content language (what
the model writes) and the catalog language (the language of the retailer's attribute names and vocabularies), because
fact names may arrive in either. Promotional terms and fact-sheet section names come from the content language only.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

from brickfill.content.models import ContentProfile, LocalePack, MarketPack
from brickfill.text import search_key

CONTENT_DIR = Path(__file__).resolve().parent
DEFAULT_LANGUAGE = "en"
DEFAULT_PROFILE = "default"

# Profile fields that the app's Settings screen (and job parameters) may override, as flat keys.
# Shape shared with the app through content-manifest.json (scripts/export_content_manifest.py).
OVERRIDE_SPECS: dict[str, dict[str, Any]] = {
    "title_max_length": {"type": "integer", "minimum": 40, "maximum": 300},
    "short_description_min_length": {"type": "integer", "minimum": 0, "maximum": 1000},
    "short_description_max_length": {"type": "integer", "minimum": 50, "maximum": 2000},
    "meta_description_min_length": {"type": "integer", "minimum": 0, "maximum": 300},
    "meta_description_max_length": {"type": "integer", "minimum": 50, "maximum": 320},
    "meta_description_required_suffixes": {"type": "string_list", "max_items": 5, "max_length": 40},
    "faq_enabled": {"type": "boolean"},
    "units": {"type": "enum", "values": ["metric", "imperial"]},
    "image_min_width": {"type": "integer", "minimum": 100, "maximum": 5000},
    "image_min_height": {"type": "integer", "minimum": 100, "maximum": 5000},
    # Category templates: title formula, fact-sheet structure and required/optional facts. Tokens, sections and
    # labels are semantic keys of the profile (brand, model, key_features...) or names in the content language.
    # "group": "template" keys are edited on the app's Category templates screen, not on Settings.
    "title_order": {"type": "string_list", "min_items": 1, "max_items": 15, "max_length": 40, "group": "template"},
    "fact_sheet_layout": {
        "type": "sections",
        "max_items": 12,
        "max_fields": 30,
        "max_length": 60,
        "group": "template",
    },
    "fact_sheet_must_include": {"type": "string_list", "max_items": 20, "max_length": 60, "group": "template"},
    "required_fact_labels": {"type": "string_list", "max_items": 30, "max_length": 60, "group": "template"},
    "optional_fact_labels": {"type": "string_list", "max_items": 30, "max_length": 60, "group": "template"},
}
# Flat override key -> (profile section, field); None as section means a top-level profile field.
_OVERRIDE_TARGETS: dict[str, tuple[str | None, str]] = {
    "title_max_length": ("title", "max_length"),
    "short_description_min_length": ("short_description", "min_length"),
    "short_description_max_length": ("short_description", "max_length"),
    "meta_description_min_length": ("meta_description", "min_length"),
    "meta_description_max_length": ("meta_description", "max_length"),
    "meta_description_required_suffixes": ("meta_description", "required_suffixes"),
    "faq_enabled": ("faq", "enabled"),
    "units": (None, "units"),
    "image_min_width": ("images", "min_width"),
    "image_min_height": ("images", "min_height"),
    "title_order": ("title", "order"),
    "fact_sheet_layout": ("fact_sheet", "layout"),
    "fact_sheet_must_include": ("fact_sheet", "must_include"),
    "required_fact_labels": (None, "required_fact_labels"),
    "optional_fact_labels": (None, "optional_fact_labels"),
}


def _ids(directory: str) -> list[str]:
    return sorted(path.stem for path in (CONTENT_DIR / directory).glob("*.json"))


def available_profiles() -> list[str]:
    return _ids("profiles")


def available_languages() -> list[str]:
    return _ids("locales")


def available_markets() -> list[str]:
    return _ids("markets")


def _read(directory: str, name: str, kind: str) -> dict[str, Any]:
    if name not in _ids(directory):
        raise ValueError(f"Unknown {kind} {name!r}; available: {', '.join(_ids(directory))}")
    return json.loads((CONTENT_DIR / directory / f"{name}.json").read_text(encoding="utf-8"))


@cache
def load_profile(profile_id: str = DEFAULT_PROFILE) -> ContentProfile:
    return ContentProfile.model_validate(_read("profiles", profile_id, "content profile"))


@cache
def load_locale(code: str = DEFAULT_LANGUAGE) -> LocalePack:
    return LocalePack.model_validate(_read("locales", code, "language"))


@cache
def load_market(code: str) -> MarketPack:
    return MarketPack.model_validate(_read("markets", code.upper(), "market"))


def validate_overrides(overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Check every flat override against :data:`OVERRIDE_SPECS`; returns a clean copy."""
    clean: dict[str, Any] = {}
    for key, value in (overrides or {}).items():
        spec = OVERRIDE_SPECS.get(key)
        if spec is None:
            raise ValueError(f"Unknown setting override {key!r}")
        kind = spec["type"]
        if kind == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"Override {key!r} must be an integer")
            if not spec["minimum"] <= value <= spec["maximum"]:
                raise ValueError(f"Override {key!r} must be between {spec['minimum']} and {spec['maximum']}")
        elif kind == "boolean":
            if not isinstance(value, bool):
                raise ValueError(f"Override {key!r} must be true or false")
        elif kind == "enum":
            if value not in spec["values"]:
                raise ValueError(f"Override {key!r} must be one of {spec['values']}")
        elif kind == "string_list":
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                raise ValueError(f"Override {key!r} must be a list of strings")
            if len(value) > spec["max_items"] or any(len(item) > spec["max_length"] for item in value):
                raise ValueError(f"Override {key!r} accepts at most {spec['max_items']} items")
            value = list(dict.fromkeys(item.strip() for item in value if item.strip()))
            if len(value) < spec.get("min_items", 0):
                raise ValueError(f"Override {key!r} needs at least {spec['min_items']} item")
        elif kind == "sections":
            value = _sections(key, value, spec)
        clean[key] = value
    return clean


def _sections(key: str, value: Any, spec: dict[str, Any]) -> list[dict[str, Any]]:
    """A fact-sheet layout: [{"section": str, "fields": [str, ...]}, ...], without blanks or repeated names."""
    if not isinstance(value, list) or len(value) > spec["max_items"]:
        raise ValueError(f"Override {key!r} must be a list of at most {spec['max_items']} sections")
    sections: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) - {"section", "fields"}:
            raise ValueError(f"Override {key!r}: each section is an object with section and fields")
        name, fields = item.get("section"), item.get("fields", [])
        if not isinstance(name, str) or not name.strip() or len(name) > spec["max_length"]:
            raise ValueError(f"Override {key!r}: section names have 1 to {spec['max_length']} characters")
        if not isinstance(fields, list) or len(fields) > spec["max_fields"]:
            raise ValueError(f"Override {key!r}: at most {spec['max_fields']} fields per section")
        if not all(isinstance(field, str) and len(field) <= spec["max_length"] for field in fields):
            raise ValueError(f"Override {key!r}: fields are names of at most {spec['max_length']} characters")
        if any(search_key(name) == search_key(section["section"]) for section in sections):
            raise ValueError(f"Override {key!r}: section {name.strip()!r} is repeated")
        sections.append(
            {"section": name.strip(), "fields": list(dict.fromkeys(f.strip() for f in fields if f.strip()))}
        )
    return sections


def apply_overrides(profile: ContentProfile, overrides: dict[str, Any] | None) -> ContentProfile:
    clean = validate_overrides(overrides)
    if not clean:
        return profile
    document = profile.model_dump()
    for key, value in clean.items():
        section, name = _OVERRIDE_TARGETS[key]
        (document if section is None else document[section])[name] = value
    return ContentProfile.model_validate(document)


def profile_defaults(profile: ContentProfile) -> dict[str, Any]:
    """The profile's value of every overridable key (the defaults shown on the Settings screen)."""
    document = profile.model_dump()
    return {
        key: (document[name] if section is None else document[section][name])
        for key, (section, name) in _OVERRIDE_TARGETS.items()
    }


def _union(*lists: list[str]) -> list[str]:
    return list(dict.fromkeys(item for values in lists for item in values))


@dataclass(frozen=True)
class EffectiveRules:
    """Everything the prompt and the deterministic checks need for one (language, profile, market) combination."""

    profile: ContentProfile
    content: LocalePack
    catalog: LocalePack
    market: MarketPack | None = None
    overrides: dict[str, Any] = field(default_factory=dict)
    # Additional instructions saved in the app (Agent instructions screen): text and version.
    agent_instructions: str = ""
    agent_instructions_version: int | None = None

    @property
    def content_language(self) -> str:
        return self.content.code

    @property
    def catalog_language(self) -> str:
        return self.catalog.code

    @property
    def market_code(self) -> str:
        return self.market.code if self.market else ""

    @property
    def packs(self) -> list[LocalePack]:
        return [self.content] if self.content.code == self.catalog.code else [self.content, self.catalog]

    @property
    def hash(self) -> str:
        document = {
            "profile": self.profile.model_dump(mode="json"),
            "content": self.content.code,
            "catalog": self.catalog.code,
            "market": self.market_code,
        }
        if self.agent_instructions:
            document["agent_instructions"] = hashlib.sha256(self.agent_instructions.encode()).hexdigest()
        return hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()[:16]

    # --- matching helpers (search keys over both packs) ---
    def fact_label_terms(self, key: str) -> list[str]:
        return _union(*(pack.fact_labels.get(key, []) for pack in self.packs)) or [key]

    def fact_label_display(self, key: str) -> str:
        """The label in the content language (first term), for prompts and issue params."""
        return (self.content.fact_labels.get(key) or self.fact_label_terms(key))[0]

    def section_name(self, key: str) -> str:
        """Localized name of a section key; a name written by the team (a template) is kept as written."""
        if key in self.content.fact_sheet_sections:
            return self.content.fact_sheet_sections[key]
        return key.replace("_", " ").title() if re.fullmatch(r"[a-z0-9_]+", key) else key

    @property
    def promotional_terms(self) -> list[str]:
        return list(self.content.promotional_terms)

    @property
    def generic_value_keys(self) -> set[str]:
        return {search_key(value) for pack in self.packs for value in pack.generic_values} - {""}

    def packaging_terms(self, kind: str) -> list[str]:
        return _union(*(getattr(pack.packaging_terms, kind) for pack in self.packs))

    @property
    def attribute_fact_aliases(self) -> dict[str, set[str]]:
        aliases: dict[str, set[str]] = {}
        for pack in self.packs:
            for name, facts in pack.attribute_fact_aliases.items():
                aliases.setdefault(search_key(name), set()).update(search_key(item) for item in facts)
        return aliases

    @property
    def brand_attribute_keys(self) -> set[str]:
        return {search_key(name) for pack in self.packs for name in pack.brand_attribute_names}

    @property
    def taxonomy_attribute_keys(self) -> set[str]:
        return {search_key(name) for pack in self.packs for name in pack.taxonomy_attribute_names}

    @property
    def unit_aliases(self) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for pack in reversed(self.packs):  # the content language wins on a conflicting alias
            aliases.update({search_key(name): search_key(unit) for name, unit in pack.unit_aliases.items()})
        return aliases

    def equivalent_values(self, first: str, second: str) -> bool:
        """Both values are in one of the market's ``value_equivalences`` groups (compared by search key)."""
        if self.market is None:
            return False
        keys = {search_key(first), search_key(second)}
        return len(keys) == 2 and any(
            keys <= {search_key(value) for value in group} for group in self.market.value_equivalences
        )

    @property
    def declared_unit_patterns(self) -> list[re.Pattern[str]]:
        patterns = _union(*(pack.declared_unit_patterns for pack in self.packs))
        return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]

    def required_fact_labels(self, seed: Any) -> list[str]:
        """Fact-label keys required for this product (``ProductSeed``): the profile's (or template's) own list plus
        the category rules that match it by id, name or synonym."""
        labels: list[str] = list(self.profile.required_fact_labels)
        for rule in self.profile.category_rules:
            if rule.match.level(seed):
                labels.extend(rule.required_fact_labels)
        return list(dict.fromkeys(labels))

    def describe(self) -> dict[str, Any]:
        """Compact identity of the rules, recorded with every run."""
        return {
            "content_language": self.content_language,
            "catalog_language": self.catalog_language,
            "content_profile": self.profile.id,
            "market": self.market_code,
            "overrides": self.overrides,
            "agent_instructions_version": self.agent_instructions_version,
            "rules_hash": self.hash,
        }


def effective_rules(
    profile: str | ContentProfile = DEFAULT_PROFILE,
    overrides: dict[str, Any] | None = None,
    content_language: str = DEFAULT_LANGUAGE,
    catalog_language: str | None = None,
    market: str | None = None,
    agent_instructions: str = "",
    agent_instructions_version: int | None = None,
) -> EffectiveRules:
    base = load_profile(profile) if isinstance(profile, str) else profile
    clean = validate_overrides(overrides)
    return EffectiveRules(
        profile=apply_overrides(base, clean),
        content=load_locale(content_language),
        catalog=load_locale(catalog_language or content_language),
        market=load_market(market) if market else None,
        overrides=clean,
        agent_instructions=agent_instructions.strip(),
        agent_instructions_version=agent_instructions_version if agent_instructions.strip() else None,
    )


@cache
def default_rules() -> EffectiveRules:
    return effective_rules()


def manifest(contract_version: str) -> dict[str, Any]:
    """The content manifest the app serves to its Settings screen (app/brickfill/config/content-manifest.json)."""
    return {
        "contract_version": contract_version,
        "languages": [{"code": code, "name": load_locale(code).name} for code in _language_order()],
        "profiles": [{"id": pid, "name": load_profile(pid).name} for pid in available_profiles()],
        "markets": [{"code": code, "name": load_market(code).name} for code in available_markets()],
        "overrides": OVERRIDE_SPECS,
        "profile_defaults": {pid: profile_defaults(load_profile(pid)) for pid in available_profiles()},
    }


LANGUAGE_ORDER = ("en", "pt-BR", "es")


def _language_order() -> list[str]:
    codes = available_languages()
    return [code for code in LANGUAGE_ORDER if code in codes] + [code for code in codes if code not in LANGUAGE_ORDER]
