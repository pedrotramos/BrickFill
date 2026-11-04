from __future__ import annotations

import re
from pathlib import Path

import pytest

from brickfill.issues import LEGACY_CODES, TEMPLATES
from brickfill.lakebase_load import (
    ATTRIBUTE_COLUMNS,
    ENRICHMENT_COLUMNS,
    ISSUE_COLUMNS,
    LATE_COLUMNS,
    REQUIREMENT_COLUMNS,
    ddl_statements,
    requirement_query,
    source_queries,
)

INTERFACE_CODES = {
    "INVALID_GTIN", "BRAND_TITLE_CONFLICT", "INVALID_LENGTH", "FACT_SHEET_MISSING_GTIN", "INVALID_ENRICHED_GTIN",
    "GTIN_LOGISTIC_RELATION_CONFLICT", "GTIN_PACKAGING_LEVEL_CONFLICT", "CATEGORY_REQUIRED_FACT",
    "TITLE_MISSING_BRAND", "TITLE_HYPHEN_SEPARATOR", "FACT_SHEET_EXTRA_SECTION", "DESCRIPTION_LINK", "META_SUFFIX", "FAQ_COUNT", "UNRESOLVED_SOURCE_CONFLICT", "EMOJI",
    "PROMOTIONAL_LANGUAGE", "DUPLICATE_ATTRIBUTE", "MISSING_ATTRIBUTE_DEFINITION", "UNKNOWN_ATTRIBUTE",
    "VOCABULARY_VALUE_NOT_ALLOWED", "VOCABULARY_VALUE_PREAPPROVED", "VOCABULARY_VALUE_PENDING",
    "MISSING_REQUIRED_ATTRIBUTE", "UNCITED_ATTRIBUTE", "MISSING_ATTRIBUTE_OBSERVATION", "GENERIC_ATTRIBUTE_VALUE",
    "NON_OFFICIAL_FAQ_SOURCE", "IMAGE_DIMENSIONS_UNKNOWN", "IMAGE_RESOLUTION", "IMAGE_BACKGROUND_UNVERIFIED",
    "NO_IMAGE_CANDIDATE", "VISUAL_EVIDENCE_INCOMPLETE", "AGENT_FAILURE",
}  # fmt: skip


def test_issue_codes_match_the_app_interface():
    assert set(TEMPLATES) == INTERFACE_CODES
    assert set(LEGACY_CODES) == {"META_ENDING", "ELECTRO_REQUIRED_FIELD", "FACT_SHEET_MISSING_EAN"}


def test_new_columns_and_migrations():
    assert {"product_id", "content_language", "content_profile", "department"} <= set(ENRICHMENT_COLUMNS)
    assert "product_code" not in ENRICHMENT_COLUMNS
    assert "params_json" in ISSUE_COLUMNS
    assert {"rejection_code", "applicability_code"} <= set(ATTRIBUTE_COLUMNS)
    ddl = "\n".join(ddl_statements('"enrichment"'))
    assert 'ALTER TABLE "enrichment".product_enrichment ADD COLUMN IF NOT EXISTS content_language TEXT' in ddl
    assert 'ALTER TABLE "enrichment".validation_issue ADD COLUMN IF NOT EXISTS params_json TEXT' in ddl
    assert "ADD COLUMN IF NOT EXISTS ean" not in ddl


def test_source_queries_select_every_column():
    queries = source_queries("`c`.`s`")
    for column in ENRICHMENT_COLUMNS:
        assert column in queries["product_enrichment"]
    for column in ISSUE_COLUMNS:
        if column != "row_id":
            assert f"t.{column}" in queries["validation_issue"]


def test_tables_written_before_this_release_load_without_the_new_columns():
    # a workspace upgraded before its next enrichment: the prepare step has not ALTERed the Delta tables yet
    old_attribute = {c for c in ATTRIBUTE_COLUMNS if c not in LATE_COLUMNS}
    old_catalog = {c for c in ENRICHMENT_COLUMNS if c not in LATE_COLUMNS}
    queries = source_queries("`c`.`s`", available={"product_attribute": old_attribute, "product_catalog": old_catalog})
    assert (
        "NULL AS required_origin" in queries["product_attribute"]
        and "t.required_origin" not in queries["product_attribute"]
    )
    assert "NULL AS prompt_version" in queries["product_enrichment"]
    assert "NULL AS instructions_version" in queries["product_enrichment"]
    # tables the map does not cover, and columns of earlier releases, are selected as they are
    assert "t.params_json" in queries["validation_issue"]
    assert "NULL AS" not in source_queries("`c`.`s`", available={"product_attribute": set()})["product_enrichment"]
    assert "t.attribute_code" in source_queries("`c`.`s`", available={"product_attribute": set()})["product_attribute"]
    # once the prepare step added them, they are read again
    full = source_queries("`c`.`s`", available={"product_attribute": set(ATTRIBUTE_COLUMNS)})
    assert "t.required_origin" in full["product_attribute"]
    assert "NULL AS source_required" in requirement_query("`c`.`s`", {"subcategory_id", "required"})
    assert "NULL AS" not in requirement_query("`c`.`s`", {"source_required"})


@pytest.mark.parametrize(
    ("table", "columns"),
    [
        ("product_enrichment", {**ENRICHMENT_COLUMNS, "loaded_at": "TIMESTAMPTZ"}),
        ("validation_issue", ISSUE_COLUMNS),
        ("attribute_requirement_source", {**REQUIREMENT_COLUMNS, "synced_at": "TIMESTAMPTZ"}),
    ],
)
def test_app_stand_in_matches_the_results_table(table, columns):
    """The app reads these empty stand-ins until the first run creates the results tables."""
    sql = (Path(__file__).parents[1] / f"app/brickfill/config/lakebase-queries/_pending_{table}.sql").read_text()
    stand_in = {name: kind for kind, name in re.findall(r"NULL::([a-z ]+?) AS (\w+)", sql)}
    expected = {
        name: re.sub(r"\s+(PRIMARY KEY|NOT NULL|DEFAULT).*", "", kind).lower() for name, kind in columns.items()
    }
    assert stand_in == expected
