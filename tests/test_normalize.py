from __future__ import annotations

from brickfill.normalize import normalize_sources

PRODUCTS = [
    {"PRODUCT_ID": "1", "GTIN": "7891234567895", "TITLE": "Drill", "SUBCATEGORY_ID": "s1", "SUBCATEGORY": "Drills",
     "CATEGORY_ID": "c1", "CATEGORY": "Tools", "BRAND": "Acme", "IS_ACTIVE": True},
    {"product_id": "2", "gtin": "7891234567895", "title": "Duplicate", "subcategory_id": "s1"},
    {"product_id": "3", "gtin": "7899999999999", "title": "Inactive", "subcategory_id": "s1", "is_active": False},
    {"product_id": "4", "gtin": "", "title": "No GTIN", "subcategory_id": "s1"},
    {"product_id": 5.0, "gtin": "7899999999999", "title": "  Saw   X ", "subcategory_id": "s2", "is_active": None},
]  # fmt: skip
ATTRIBUTES = [
    {"attribute_id": "a1", "attribute_name": "Color", "subcategory_id": "s1", "is_required": None},
    {"attribute_id": "a1", "attribute_name": "Color", "subcategory_id": "s2", "is_required": False,
     "attribute_role": "COLOR", "sort_order": 2},
    {"attribute_id": "a2", "attribute_name": "Power", "subcategory_id": "s1", "unit": "W", "value_type": "number"},
]  # fmt: skip
OPTIONS = [
    {"attribute_id": "a1", "option_id": "o1", "option_value": "Blue"},
    {"attribute_id": "a1", "option_id": "o2", "option_value": "Blue"},
    {"attribute_id": "a1", "option_id": "o3", "option_value": "Red", "is_active": False},
    {"attribute_id": "zz", "option_id": "o4", "option_value": "Orphan"},
]


def test_products():
    products, _attributes, _options, report = normalize_sources(PRODUCTS, [], [], attributes_required_default=True)
    assert [item["product_id"] for item in products] == ["1", "5"]
    assert products[0]["ean"] == "7891234567895" and products[0]["brand"] == "Acme"
    assert products[1]["source_title"] == "Saw X"
    assert report.duplicate_gtins == ["7891234567895"]
    assert (report.skipped_inactive, report.skipped_incomplete) == (1, 1)


def test_attributes_and_options():
    _products, attributes, options, report = normalize_sources(
        [], ATTRIBUTES, OPTIONS, attributes_required_default=True
    )
    by_key = {(item["subcategory_id"], item["attribute_code"]): item for item in attributes}
    assert by_key[("s1", "a1")]["required"] is True
    assert by_key[("s2", "a1")]["required"] is False
    assert by_key[("s2", "a1")]["attribute_role"] == "color"
    assert by_key[("s1", "a2")]["unit"] == "W" and by_key[("s1", "a2")]["value_type"] == "number"
    assert [item["allowed_value"] for item in options] == ["Blue"]
    assert report.skipped_inactive_options == 1
