from __future__ import annotations

from typing import Any

import pytest

from brickfill.models import (
    AttributeDefinition,
    CatalogAttribute,
    Evidence,
    Fact,
    FactSheetSection,
    ImageCandidate,
    LabelValue,
    ProductEnrichment,
    ProductSeed,
    SourceTier,
)

OFFICIAL_URL = "https://brand.example.com/products/drill-x100"
RETAILER_URL = "https://shop.example.net/p/drill-x100"
EAN = "7891234567895"


def evidence(
    url: str = OFFICIAL_URL, tier: SourceTier = SourceTier.OFFICIAL, excerpt: str = "Power: 750 W"
) -> Evidence:
    return Evidence(url=url, source_tier=tier, excerpt=excerpt)


def fact(name: str, value: str, url: str = OFFICIAL_URL, tier: SourceTier = SourceTier.OFFICIAL, confidence=0.9):
    return Fact(name=name, value=value, confidence=confidence, evidence=[evidence(url, tier, f"{name}: {value}")])


@pytest.fixture
def seed() -> ProductSeed:
    return ProductSeed(
        source_title="IMPACT DRILL ACME X100 750W",
        ean=EAN,
        brand="Acme",
        category="Tools",
        subcategory="Drills",
    )


def make_result(**overrides: Any) -> ProductEnrichment:
    values: dict[str, Any] = {
        "ean": EAN,
        "verified_brand": "Acme",
        "model": "X100",
        "supplier": "Acme Tools Inc.",
        "generated_title": "Impact Drill Acme X100 750 W",
        "short_description": (
            "The Acme X100 impact drill delivers 750 W for drilling wood, metal and masonry, with a keyless chuck "
            "and variable speed for precise everyday work at home."
        ),
        "meta_description": "Acme X100 impact drill with 750 W, keyless chuck and variable speed for every job.",
        "fact_sheet": [
            FactSheetSection(
                name="Key features",
                items=[LabelValue(label="Brand", value="Acme"), LabelValue(label="GTIN", value=EAN)],
            )
        ],
        "attributes": [],
        "facts": [fact("Power", "750 W")],
        "images": [
            ImageCandidate(
                url="https://brand.example.com/img/x100.jpg",
                source_url=OFFICIAL_URL,
                width=2000,
                height=2000,
                white_background=True,
            )
        ],
        "research_summary": "Official page found.",
    }
    values.update(overrides)
    return ProductEnrichment(**values)


@pytest.fixture
def result() -> ProductEnrichment:
    return make_result()


def definition(code: str, name: str, *, required: bool = False, vocabulary: list[str] | None = None, **extra: Any):
    return AttributeDefinition(code=code, name=name, required=required, vocabulary=vocabulary or [], **extra)


def attribute(code: str, value: str | None = None, **extra: Any) -> CatalogAttribute:
    return CatalogAttribute(code=code, value=value, **extra)
