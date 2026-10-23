"""Matching of quoted excerpts on a page's text map (synthetic maps; no browser, no Firecrawl)."""

from __future__ import annotations

from brickfill.visual_evidence import _quoted_blocks, _visible_excerpt, crop_value, table_cells


def block(context: str, top: float) -> dict:
    return {"text": context, "context": context, "box": [10.0, top, 600.0, 40.0]}


SPEC_TABLE = {
    "blocks": [
        block("Acme X100 impact drill 750 W", 0),
        block("2026-01-10 Active Acme X100A 220V, Power: 750 W, Chuck: 13 mm", 100),
        block("2026-01-10 Active Acme X100B 127V, Power: 750 W, Chuck: 13 mm", 150),
        block("Net capacity (L): 387 l", 200),
        block("Shelves: 3 - 2 (Tempered glass) + 1 (Plastic)", 250),
    ]
}


def boxes(excerpt: str, value: str) -> set:
    return _quoted_blocks(SPEC_TABLE, _visible_excerpt(excerpt), value, table_cells(excerpt))


def test_crop_value_prefers_what_the_quote_writes():
    assert crop_value("Net capacity (L): 387 l", "387 Litros", "387 l") == "387 l"
    # normalized by the model and absent from the quote: the verbatim quote locates the block
    excerpt = "Shelves: 3 - 2 (Tempered glass) + 1 (Plastic)"
    assert crop_value(excerpt, "2 glass + 1 plastic") == excerpt
    assert crop_value(None, "750 W") == "750 W"


def test_normalized_value_is_found_through_the_quote():
    excerpt = "Net capacity (L): 387 l"
    assert boxes(excerpt, crop_value(excerpt, "387 Litros")) == {(10.0, 200.0, 600.0, 40.0)}
    excerpt = "Shelves: 3 - 2 (Tempered glass) + 1 (Plastic)"
    assert boxes(excerpt, crop_value(excerpt, "2 glass + 1 plastic")) == {(10.0, 250.0, 600.0, 40.0)}


def test_table_row_with_a_cell_the_page_does_not_show():
    # Markdown quotes a trailing cell ("- 7891234567895") that is not in the visible row: the value's cell and
    # another cell of the quote (the model code) still identify one row.
    excerpt = "X100B | 127V, Power: 750 W, Chuck: 13 mm | - 7891234567895"
    assert table_cells(excerpt) == ["X100B", "127V, Power: 750 W, Chuck: 13 mm", "7891234567895"]
    assert boxes(excerpt, "127V") == {(10.0, 150.0, 600.0, 40.0)}


def test_value_shared_by_rows_needs_its_own_row():
    # "750 W" is in every row: without an anchor cell it would be ambiguous, never cropped from the wrong row.
    assert boxes("X100A | 220V, Power: 750 W, Chuck: 13 mm", "750 W") == {(10.0, 100.0, 600.0, 40.0)}
    assert len(boxes("Power: 750 W", "750 W")) == 2  # ambiguous: not cropped
