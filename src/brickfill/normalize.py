"""Canonical source rows (``v_products``, ``v_attributes``, ``v_attribute_options``) to the enrichment working rows.

Pure Python on purpose (no Spark), so it is tested locally; ``prepare`` reads the views and writes the results.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return " ".join(str(value).split())


def _get(row: dict[str, Any], name: str) -> Any:
    """Read a column without depending on the case Spark returns it in."""
    if name in row:
        return row[name]
    for key, value in row.items():
        if key.lower() == name:
            return value
    return None


def _text(row: dict[str, Any], name: str) -> str:
    return clean(_get(row, name))


def _flag(row: dict[str, Any], name: str) -> bool | None:
    value = _get(row, name)
    return None if value is None else bool(value)


@dataclass
class NormalizeReport:
    products: int = 0
    skipped_inactive: int = 0
    skipped_incomplete: int = 0
    duplicate_gtins: list[str] = field(default_factory=list)
    attributes: int = 0
    options: int = 0
    skipped_inactive_options: int = 0

    def summary(self) -> str:
        duplicates = f", {len(self.duplicate_gtins)} duplicate GTINs kept once" if self.duplicate_gtins else ""
        return (
            f"{self.products} products ({self.skipped_inactive} inactive and {self.skipped_incomplete} incomplete "
            f"skipped{duplicates}), {self.attributes} attribute definitions, {self.options} vocabulary values"
        )


def normalize_sources(
    product_rows: Iterable[dict[str, Any]],
    attribute_rows: Iterable[dict[str, Any]],
    option_rows: Iterable[dict[str, Any]],
    *,
    attributes_required_default: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], NormalizeReport]:
    """Products, attribute definitions and allowed values for the working tables.

    Products keep the contract's ``gtin`` as ``ean`` (the internal key of every result table). Inactive products and
    options are skipped; a GTIN listed twice is kept once (the contract check reports it). ``is_required`` NULL takes
    ``attributes_required_default``.
    """
    report = NormalizeReport()
    products: list[dict[str, Any]] = []
    seen_gtins: set[str] = set()
    for row in product_rows:
        if _flag(row, "is_active") is False:
            report.skipped_inactive += 1
            continue
        gtin, title = _text(row, "gtin"), _text(row, "title")
        if not gtin or not title or not _text(row, "subcategory_id"):
            report.skipped_incomplete += 1
            continue
        if gtin in seen_gtins:
            report.duplicate_gtins.append(gtin)
            continue
        seen_gtins.add(gtin)
        products.append(
            {
                "product_id": _text(row, "product_id"),
                "ean": gtin,
                "source_title": title,
                "title_alt": _text(row, "title_alt"),
                "brand": _text(row, "brand"),
                "supplier": _text(row, "supplier"),
                "department_id": _text(row, "department_id"),
                "department": _text(row, "department"),
                "category_id": _text(row, "category_id"),
                "category": _text(row, "category"),
                "subcategory_id": _text(row, "subcategory_id"),
                "subcategory": _text(row, "subcategory"),
            }
        )
    report.products = len(products)

    attributes_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    attribute_names: dict[str, str] = {}
    for row in attribute_rows:
        attribute_id, subcategory_id = _text(row, "attribute_id"), _text(row, "subcategory_id")
        name = _text(row, "attribute_name")
        if not (attribute_id and subcategory_id and name):
            continue
        required = _flag(row, "is_required")
        sort_order = _get(row, "sort_order")
        record = {
            "subcategory_id": subcategory_id,
            "category_id": _text(row, "category_id"),
            "subcategory": _text(row, "subcategory"),
            "attribute_code": attribute_id,
            "attribute_name": name,
            "attribute_description": _text(row, "attribute_description"),
            "required": attributes_required_default if required is None else required,
            "value_type": _text(row, "value_type").lower() or "text",
            "unit": _text(row, "unit"),
            "attribute_role": _text(row, "attribute_role").lower(),
            "allows_free_text": bool(_flag(row, "allows_free_text")),
            "sort_order": int(sort_order) if sort_order is not None else None,
        }
        attribute_names.setdefault(attribute_id, name)
        attributes_by_key.setdefault((subcategory_id, attribute_id), record)
    report.attributes = len(attributes_by_key)

    answers: list[dict[str, Any]] = []
    seen_answers: set[tuple[str, str]] = set()
    for row in option_rows:
        if _flag(row, "is_active") is False:
            report.skipped_inactive_options += 1
            continue
        code, answer = _text(row, "attribute_id"), _text(row, "option_value")
        if not code or not answer or (code, answer) in seen_answers or code not in attribute_names:
            continue
        seen_answers.add((code, answer))
        sort_order = _get(row, "sort_order")
        answers.append(
            {
                "attribute_code": code,
                "attribute_name": attribute_names[code],
                "allowed_value": answer,
                "sort_order": int(sort_order) if sort_order is not None else None,
            }
        )
    report.options = len(answers)
    return products, list(attributes_by_key.values()), answers, report
