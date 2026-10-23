"""Validation of the canonical views against the contract: schema first, then data checks.

Pure Python (SQL builders and evaluators), so the rules are unit-tested without Spark; ``source_layer`` runs them.
Each data check is one query returning ``failing_rows`` and up to 20 sample keys.
"""

from __future__ import annotations

from dataclasses import dataclass

from brickfill.contract import ATTRIBUTE_OPTIONS, ATTRIBUTES, PRODUCTS, VIEWS, ViewContract, sql_string

SAMPLE_SIZE = 20
SEVERITIES = ("ERROR", "WARNING", "INFO")

# Spark reports these names in DESCRIBE / schema simpleString; INT and INTEGER are the same type.
_TYPE_ALIASES = {"integer": "int", "long": "bigint", "short": "smallint", "byte": "tinyint"}


def _normalized_type(value: str) -> str:
    lowered = value.strip().lower()
    return _TYPE_ALIASES.get(lowered, lowered)


@dataclass(frozen=True)
class SchemaIssue:
    view: str
    code: str  # MISSING_COLUMN | WRONG_TYPE
    column: str
    detail: str


def schema_issues(contract: ViewContract, described: list[tuple[str, str]]) -> list[SchemaIssue]:
    """Missing columns and wrong types of a view, given ``(name, type)`` pairs as Spark describes them."""
    actual = {name.lower(): _normalized_type(kind) for name, kind in described}
    issues: list[SchemaIssue] = []
    for column in contract.columns:
        found = actual.get(column.name)
        if found is None:
            issues.append(SchemaIssue(contract.default_name, "MISSING_COLUMN", column.name, f"expected {column.type}"))
        elif found != _normalized_type(column.type):
            issues.append(
                SchemaIssue(contract.default_name, "WRONG_TYPE", column.name, f"expected {column.type}, got {found}")
            )
    return issues


@dataclass(frozen=True)
class Check:
    view: str
    code: str
    severity: str
    description: str
    sql: str


def _keys(contract: ViewContract) -> str:
    # Evaluated outside the check's subquery, so it can't use the subquery's table aliases.
    return "concat_ws('|', " + ", ".join(f"CAST({name} AS STRING)" for name in contract.primary_key) + ")"


def _check(contract: ViewContract, code: str, severity: str, description: str, source: str, key_expr: str) -> Check:
    """A check over ``source`` (a FROM clause whose rows are the failures)."""
    sql = f"SELECT COUNT(*) AS failing_rows, slice(collect_list({key_expr}), 1, {SAMPLE_SIZE}) AS sample FROM {source}"
    return Check(contract.default_name, code, severity, description, sql)


def gtin_valid_expression(column: str) -> str:
    """SQL boolean: ``column`` is a GTIN-8/12/13/14 of digits with a correct GS1 check digit (no UDF needed)."""
    g = column
    return (
        f"({g} RLIKE '^[0-9]{{8}}$|^[0-9]{{12,14}}$' AND "
        f"(10 - aggregate(sequence(1, length({g}) - 1), 0, "
        f"(acc, i) -> acc + CAST(substr({g}, length({g}) - i, 1) AS INT) * IF(i % 2 = 1, 3, 1)) % 10) % 10 "
        f"= CAST(substr({g}, -1) AS INT))"
    )


def data_checks(namespace: str) -> list[Check]:
    """Every data check of the contract; ``namespace`` is the quoted ``catalog.schema`` of the views."""
    products = f"{namespace}.`{PRODUCTS.default_name}`"
    attributes = f"{namespace}.`{ATTRIBUTES.default_name}`"
    options = f"{namespace}.`{ATTRIBUTE_OPTIONS.default_name}`"
    tables = {PRODUCTS.key: products, ATTRIBUTES.key: attributes, ATTRIBUTE_OPTIONS.key: options}
    checks: list[Check] = []

    for contract in VIEWS:
        table = tables[contract.key]
        key_columns = ", ".join(contract.primary_key)
        checks.append(
            _check(
                contract,
                "PK_DUPLICATE",
                "ERROR",
                f"More than one row per primary key ({key_columns})",
                f"(SELECT {key_columns} FROM {table} GROUP BY {key_columns} HAVING COUNT(*) > 1)",
                _keys(contract),
            )
        )
        for column in contract.required_columns:
            blank = f"{column} IS NULL" + (
                f" OR TRIM({column}) = ''" if contract.column(column).type == "STRING" else ""
            )
            checks.append(
                _check(
                    contract,
                    "NULL_IN_NOT_NULL",
                    "ERROR",
                    f"{column} is NULL or blank",
                    f"(SELECT * FROM {table} WHERE {blank})",
                    _keys(contract),
                )
            )
        for column in contract.columns:
            if column.enum:
                allowed = ", ".join(sql_string(value) for value in column.enum)
                checks.append(
                    _check(
                        contract,
                        "ENUM_INVALID",
                        "ERROR",
                        f"{column.name} outside: {', '.join(column.enum)}",
                        f"(SELECT * FROM {table} WHERE {column.name} IS NOT NULL AND {column.name} NOT IN ({allowed}))",
                        _keys(contract),
                    )
                )

    checks.append(
        _check(
            PRODUCTS,
            "GTIN_DUPLICATE",
            "ERROR",
            "The same gtin on more than one product",
            f"(SELECT gtin AS product_id FROM {products} WHERE gtin IS NOT NULL GROUP BY gtin HAVING COUNT(*) > 1)",
            "product_id",
        )
    )
    checks.append(
        _check(
            PRODUCTS,
            "GTIN_INVALID",
            "ERROR",
            "gtin is not 8, 12, 13 or 14 digits with a valid check digit",
            f"(SELECT * FROM {products} WHERE gtin IS NOT NULL AND NOT {gtin_valid_expression('gtin')})",
            _keys(PRODUCTS),
        )
    )
    checks.append(
        _check(
            ATTRIBUTE_OPTIONS,
            "OPTION_ORPHAN_ATTRIBUTE",
            "ERROR",
            "Option of an attribute absent from v_attributes",
            f"(SELECT o.* FROM {options} o LEFT ANTI JOIN {attributes} a ON a.attribute_id = o.attribute_id)",
            _keys(ATTRIBUTE_OPTIONS),
        )
    )
    checks.append(
        _check(
            PRODUCTS,
            "SUBCATEGORY_WITHOUT_ATTRIBUTES",
            "WARNING",
            "Subcategory with active products but no attribute in v_attributes (only editorial content is generated)",
            f"(SELECT DISTINCT p.subcategory_id AS product_id FROM {products} p LEFT ANTI JOIN {attributes} a "
            "ON a.subcategory_id = p.subcategory_id WHERE COALESCE(p.is_active, TRUE))",
            "product_id",
        )
    )
    checks.append(
        _check(
            ATTRIBUTES,
            "ATTRIBUTE_SCOPE_UNUSED",
            "INFO",
            "Attribute scoped to a subcategory without products",
            f"(SELECT a.* FROM {attributes} a LEFT ANTI JOIN {products} p ON p.subcategory_id = a.subcategory_id)",
            _keys(ATTRIBUTES),
        )
    )
    checks.append(
        _check(
            ATTRIBUTES,
            "REQUIRED_FLAG_NULL",
            "INFO",
            "is_required is NULL (attributes_required_default applies)",
            f"(SELECT * FROM {attributes} WHERE is_required IS NULL)",
            _keys(ATTRIBUTES),
        )
    )
    return checks


def should_fail(results: list[dict], fail_on: str = "error") -> bool:
    """Whether the job fails: ``fail_on`` is ``error`` (default), ``warning`` or ``never``."""
    if fail_on not in ("error", "warning", "never"):
        raise ValueError(f'contract_fail_on must be "error", "warning" or "never"; received {fail_on!r}')
    if fail_on == "never":
        return False
    blocking = {"ERROR"} if fail_on == "error" else {"ERROR", "WARNING"}
    return any(result["severity"] in blocking and result["failing_rows"] > 0 for result in results)
