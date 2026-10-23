"""The BrickFill source contract: the three canonical views every retailer exposes, whatever its ERP looks like.

This module is the single source of truth of the contract. ``source_views`` turns it into documented views (one
``COMMENT`` per column, ``TBLPROPERTIES`` with the contract version), ``contract_check`` validates the data against it,
and ``scripts/export_contract_doc.py`` renders ``adapters/README.md`` from it.

A retailer maps its own tables with an *adapter*: one ``SELECT`` per view returning the canonical column names
(``adapters/<name>/{products,attributes,attribute_options}.sql``). Pure Python on purpose, so it is testable without
Spark.
"""

from __future__ import annotations

from dataclasses import dataclass

CONTRACT_VERSION = "1"

VALUE_TYPES = ("text", "number", "boolean", "date")
ATTRIBUTE_ROLES = ("brand", "manufacturer", "supplier", "model", "color", "size", "taxonomy", "other")


@dataclass(frozen=True)
class Column:
    name: str
    type: str  # Spark SQL type
    nullable: bool
    comment: str
    enum: tuple[str, ...] = ()

    def documented_comment(self) -> str:
        """The column comment written on the view: meaning plus the rules a view cannot declare."""
        notes = [] if self.nullable else ["NOT NULL"]
        if self.enum:
            notes.append("one of: " + ", ".join(self.enum))
        return self.comment + (f" [{'; '.join(notes)}]" if notes else "")


@dataclass(frozen=True)
class ViewContract:
    key: str  # adapter file name and job parameter suffix
    default_name: str
    comment: str
    primary_key: tuple[str, ...]
    columns: tuple[Column, ...]
    grain: str = ""  # what one row is, for the documentation
    unique: tuple[tuple[str, ...], ...] = ()

    @property
    def column_names(self) -> list[str]:
        return [column.name for column in self.columns]

    @property
    def required_columns(self) -> list[str]:
        return [column.name for column in self.columns if not column.nullable]

    def column(self, name: str) -> Column:
        return next(column for column in self.columns if column.name == name)


PRODUCTS = ViewContract(
    key="products",
    default_name="v_products",
    comment=(
        f"BrickFill canonical products (contract v{CONTRACT_VERSION}). One row per sellable item of the retailer's "
        "catalog, the input of the enrichment and the catalog the review app lists. Primary key product_id; gtin is "
        "unique. Built by an adapter over the retailer's own tables; see adapters/README.md."
    ),
    primary_key=("product_id",),
    grain="sellable item",
    unique=(("gtin",),),
    columns=(
        Column("product_id", "STRING", False, "Retailer's stable internal id of the item (SKU code). Primary key."),
        Column(
            "gtin",
            "STRING",
            False,
            "GTIN-8, -12 (UPC), -13 (EAN) or -14 of the item, digits only, leading zeros kept. Unique; the "
            "enrichment searches the web by it and keys every result on it.",
        ),
        Column(
            "title",
            "STRING",
            False,
            "Best title the retailer has for the item (ERP or e-commerce). Resolve fallbacks in the adapter, e.g. "
            "COALESCE(NULLIF(TRIM(erp_title), ''), web_title).",
        ),
        Column("title_alt", "STRING", True, "Secondary or long title; extra context for search and for the model."),
        Column(
            "brand",
            "STRING",
            True,
            "Brand recorded by the retailer. NULL when unknown: the agent then discovers and verifies it.",
        ),
        Column("supplier", "STRING", True, "Supplier or vendor of the item (a hint for the research, never evidence)."),
        Column("department_id", "STRING", True, "Id of the top taxonomy level (department or section)."),
        Column("department", "STRING", True, "Name of the top taxonomy level."),
        Column("category_id", "STRING", False, "Id of the middle taxonomy level (category)."),
        Column("category", "STRING", False, "Name of the category, as reviewers know it."),
        Column(
            "subcategory_id",
            "STRING",
            False,
            "Id of the leaf taxonomy level; attribute applicability (v_attributes) is keyed on it. With a two-level "
            "taxonomy, repeat the category.",
        ),
        Column("subcategory", "STRING", False, "Name of the subcategory."),
        Column(
            "is_active",
            "BOOLEAN",
            True,
            "FALSE excludes the item from enrichment and from the app. NULL counts as TRUE.",
        ),
        Column("source_updated_at", "TIMESTAMP", True, "Last change of the item in the source (informational)."),
    ),
)

ATTRIBUTES = ViewContract(
    key="attributes",
    default_name="v_attributes",
    comment=(
        f"BrickFill canonical attributes (contract v{CONTRACT_VERSION}). One row per attribute and subcategory where "
        "it applies: the attribute matrix the enrichment fills for every product of the subcategory. Primary key "
        "(attribute_id, subcategory_id). An attribute with active rows in v_attribute_options has a controlled "
        "vocabulary."
    ),
    primary_key=("attribute_id", "subcategory_id"),
    grain="attribute and subcategory where it applies",
    columns=(
        Column("attribute_id", "STRING", False, "Retailer's id of the attribute."),
        Column(
            "attribute_name",
            "STRING",
            False,
            "Display name of the attribute in the catalog language (shown to the model and to reviewers).",
        ),
        Column(
            "attribute_description",
            "STRING",
            True,
            "Guidance on what the attribute means or how to fill it; sent to the model.",
        ),
        Column(
            "subcategory_id", "STRING", False, "Subcategory where the attribute applies (v_products.subcategory_id)."
        ),
        Column("category_id", "STRING", True, "Category of the subcategory (denormalized, for readability)."),
        Column("subcategory", "STRING", True, "Name of the subcategory (denormalized, for readability)."),
        Column(
            "is_required",
            "BOOLEAN",
            True,
            "Whether the attribute must be filled for the subcategory. NULL falls back to the job parameter "
            "attributes_required_default.",
        ),
        Column("value_type", "STRING", True, "Kind of value; NULL means text.", VALUE_TYPES),
        Column(
            "unit",
            "STRING",
            True,
            "Unit of numeric values (cm, g, W, in, ...). When set, the vocabulary may hold bare numbers and the code "
            "matches 16,44 cm to 16.44.",
        ),
        Column(
            "attribute_role",
            "STRING",
            True,
            "Semantic role used by the deterministic matching (brand aliases, taxonomy guard). NULL means other.",
            ATTRIBUTE_ROLES,
        ),
        Column(
            "allows_free_text",
            "BOOLEAN",
            True,
            "Only meaningful when the attribute has options: TRUE makes them suggestions instead of a closed list. "
            "NULL counts as FALSE.",
        ),
        Column("sort_order", "INT", True, "Display order of the attribute in the review app."),
    ),
)

ATTRIBUTE_OPTIONS = ViewContract(
    key="attribute_options",
    default_name="v_attribute_options",
    comment=(
        f"BrickFill canonical attribute options (contract v{CONTRACT_VERSION}). The allowed values (vocabulary) of "
        "each attribute; a value is published only when it matches one of them exactly or by an approved alias. "
        "Primary key (attribute_id, option_id)."
    ),
    primary_key=("attribute_id", "option_id"),
    grain="allowed value of an attribute",
    columns=(
        Column("attribute_id", "STRING", False, "Attribute the option belongs to (v_attributes.attribute_id)."),
        Column("option_id", "STRING", False, "Retailer's id of the option."),
        Column("option_value", "STRING", False, "The value exactly as it must be published."),
        Column("sort_order", "INT", True, "Display order of the option."),
        Column("is_active", "BOOLEAN", True, "FALSE retires the option. NULL counts as TRUE."),
    ),
)

VIEWS: tuple[ViewContract, ...] = (PRODUCTS, ATTRIBUTES, ATTRIBUTE_OPTIONS)


def view(key: str) -> ViewContract:
    return next(item for item in VIEWS if item.key == key)


def sql_string(value: str) -> str:
    """A Spark SQL string literal (single quotes and backslashes escaped)."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"
