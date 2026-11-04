"""Schemas of the content profile, locale pack and market pack JSON files.

* A **profile** holds the editorial policy of a retailer (lengths, title order, fact-sheet sections, image rules,
  category rules). Labels and sections are semantic keys, so one profile works for every language.
* A **locale pack** holds what depends on a language: localized section names and fact labels, and the term lists
  the deterministic checks match (promotional terms, generic values, packaging terms, attribute aliases, units).
* A **market pack** holds what depends on a country: regulatory bodies, search location and domains to rank last.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from brickfill.text import search_key

SECTION_KEYS = ("key_features", "additional_features", "dimensions_weight", "package_contents")
FACT_LABEL_KEYS = ("brand", "supplier", "model", "gtin", "warranty", "height", "width", "depth", "weight", "color")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TitleRules(_Strict):
    max_length: int = Field(default=150, ge=20, le=500)
    require_brand: bool = True
    order: list[str] = Field(
        default_factory=lambda: [
            "product_type",
            "brand",
            "model",
            "key_feature",
            "secondary_feature",
            "color",
            "variant",
            "quantity",
        ]
    )
    uppercase_model: bool = False
    no_voltage_in_parent_title: bool = False


class ShortDescriptionRules(_Strict):
    min_length: int = Field(default=120, ge=0, le=5000)
    max_length: int = Field(default=300, ge=20, le=5000)
    truncate: bool = True
    forbid_links: bool = True

    @model_validator(mode="after")
    def _range(self) -> ShortDescriptionRules:
        if self.min_length > self.max_length:
            raise ValueError("short_description.min_length must not exceed max_length")
        return self


class MetaDescriptionRules(_Strict):
    min_length: int = Field(default=70, ge=0, le=1000)
    max_length: int = Field(default=160, ge=20, le=1000)
    required_suffixes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _range(self) -> MetaDescriptionRules:
        if self.min_length > self.max_length:
            raise ValueError("meta_description.min_length must not exceed max_length")
        return self


class FactSheetSection(_Strict):
    """One section of a fact-sheet layout: a section key (or a name in the content language) and its fields."""

    section: str = Field(min_length=1, max_length=60)
    fields: list[str] = Field(default_factory=list, max_length=30)


class FactSheetRules(_Strict):
    sections: list[str] = Field(default_factory=lambda: list(SECTION_KEYS))
    must_include_gtin: bool = True
    must_include: list[str] = Field(default_factory=lambda: ["brand", "supplier"])
    # When set (a category template), the fact sheet has exactly these sections and fields, in this order.
    layout: list[FactSheetSection] = Field(default_factory=list, max_length=12)


class FAQRules(_Strict):
    enabled: bool = True
    min: int = Field(default=5, ge=0, le=50)
    max: int = Field(default=8, ge=0, le=50)
    official_sources_only: bool = True


class ImageRules(_Strict):
    required: bool = True
    min_width: int = Field(default=1000, ge=1, le=20000)
    min_height: int = Field(default=1000, ge=1, le=20000)
    check_white_background: bool = True


class CategoryMatch(_Strict):
    department_ids: list[str] = Field(default_factory=list)
    category_ids: list[str] = Field(default_factory=list)
    subcategory_ids: list[str] = Field(default_factory=list)
    # Names are compared case- and accent-insensitively.
    department_names: list[str] = Field(default_factory=list)
    category_names: list[str] = Field(default_factory=list)
    subcategory_names: list[str] = Field(default_factory=list)
    # Alternative names the sources use for the same product type, compared like the names at every level.
    synonyms: list[str] = Field(default_factory=list)

    def level(self, seed: Any) -> int:
        """How specifically this matches a product (``ProductSeed``): 3 subcategory, 2 category, 1 department, 0 no.

        Ids and names match their own level; a synonym matches the level whose name it equals.
        """
        synonyms = {search_key(name) for name in self.synonyms} - {""}
        best = 0
        for rank, ids, names, value_id, value_name in (
            (1, self.department_ids, self.department_names, seed.department_id, seed.department),
            (2, self.category_ids, self.category_names, seed.category_id, seed.category),
            (3, self.subcategory_ids, self.subcategory_names, seed.subcategory_id, seed.subcategory),
        ):
            key = search_key(value_name or "")
            if (value_id and value_id in ids) or (
                key and (key in {search_key(name) for name in names} or key in synonyms)
            ):
                best = rank
        return best


class CategoryRule(_Strict):
    match: CategoryMatch
    required_fact_labels: list[str] = Field(default_factory=list)


class ContentProfile(_Strict):
    id: str
    name: str
    version: int = 1
    title: TitleRules = Field(default_factory=TitleRules)
    short_description: ShortDescriptionRules = Field(default_factory=ShortDescriptionRules)
    meta_description: MetaDescriptionRules = Field(default_factory=MetaDescriptionRules)
    fact_sheet: FactSheetRules = Field(default_factory=FactSheetRules)
    faq: FAQRules = Field(default_factory=FAQRules)
    images: ImageRules = Field(default_factory=ImageRules)
    units: Literal["metric", "imperial"] = "metric"
    forbid_emojis: bool = True
    brand_must_appear_in_source_title: bool = False
    category_rules: list[CategoryRule] = Field(default_factory=list)
    # Facts every product of the profile (or of a category template) must / may show in the fact sheet.
    required_fact_labels: list[str] = Field(default_factory=list)
    optional_fact_labels: list[str] = Field(default_factory=list)
    severity_overrides: dict[str, Literal["ERROR", "WARNING", "INFO"]] = Field(default_factory=dict)
    disabled_rules: list[str] = Field(default_factory=list)


class PackagingTerms(_Strict):
    logistic: list[str] = Field(default_factory=list)
    unit: list[str] = Field(default_factory=list)


class LocalePack(_Strict):
    code: str
    name: str  # native name, shown in the app
    english_name: str  # used in the (English) model instructions
    fact_sheet_sections: dict[str, str]
    fact_labels: dict[str, list[str]]
    promotional_terms: list[str] = Field(default_factory=list)
    generic_values: list[str] = Field(default_factory=list)
    packaging_terms: PackagingTerms = Field(default_factory=PackagingTerms)
    attribute_fact_aliases: dict[str, list[str]] = Field(default_factory=dict)
    brand_attribute_names: list[str] = Field(default_factory=list)
    taxonomy_attribute_names: list[str] = Field(default_factory=list)
    unit_aliases: dict[str, str] = Field(default_factory=dict)
    declared_unit_patterns: list[str] = Field(default_factory=list)


class MarketPack(_Strict):
    code: str
    name: str
    country: str  # ISO 3166-1 alpha-2, sent to Firecrawl scrape as location.country
    languages: list[str] = Field(default_factory=list)  # sent to Firecrawl scrape as location.languages
    search_location: str = ""  # sent to Firecrawl search as location
    regulatory_bodies: list[str] = Field(default_factory=list)
    deprioritized_domains: list[str] = Field(default_factory=list)
    preferred_domains: list[str] = Field(default_factory=list)
    # Groups of values that denote the same thing in this market (e.g. the nominal "110V" and the measured "127V").
    value_equivalences: list[list[str]] = Field(default_factory=list)
