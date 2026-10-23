from __future__ import annotations

from brickfill.mock_data import TABLES, generate
from brickfill.quality import validate_gtin


def test_deterministic():
    assert generate(300, seed=7) == generate(300, seed=7)
    assert generate(300, seed=7) != generate(300, seed=8)


def test_shape_and_integrity():
    tables = generate(2000)
    assert set(tables) == set(TABLES)
    for name, (columns, rows) in tables.items():
        assert columns == TABLES[name]
        assert all(len(row) == len(columns) for row in rows)
    items = tables["erp_item"][1]
    gtins = [row[1] for row in items]
    assert len(set(gtins)) == len(gtins)
    assert all(validate_gtin(gtin) and gtin.lstrip("1").startswith("2") for gtin in gtins)
    subcategories = {row[0] for row in tables["erp_subcategory"][1]}
    assert {row[2] for row in items} <= subcategories
    attributes = {row[0] for row in tables["erp_attribute"][1]}
    assert {row[0] for row in tables["erp_attribute_scope"][1]} <= attributes
    assert {row[0] for row in tables["erp_attribute_option"][1]} <= attributes
    assert {row[2] for row in tables["erp_attribute_scope"][1]} <= {"Y", "N"}
    assert {row[0] for row in tables["erp_item_text"][1]} <= {row[0] for row in items}
