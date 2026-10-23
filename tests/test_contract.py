from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

from brickfill.contract import ATTRIBUTES, PRODUCTS, VIEWS, sql_string
from brickfill.contract_check import data_checks, gtin_valid_expression, schema_issues, should_fail
from brickfill.mock_data import gtin13, gtin14
from brickfill.quality import validate_gtin
from brickfill.source_views import load_adapter, render, view_statement, view_statements

ROOT = Path(__file__).resolve().parents[1]
ADAPTERS = ROOT / "adapters"


def _script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_view_statement_documents_every_column():
    statement = view_statement(PRODUCTS, "SELECT 1 AS product_id", "`c`.`s`", "mock")
    for column in PRODUCTS.columns:
        assert f"{column.name} COMMENT '" in statement
        assert f"CAST(src.{column.name} AS {column.type}) AS {column.name}" in statement
    assert "'brickfill.contract_version' = '1'" in statement
    assert "'brickfill.adapter' = 'mock'" in statement
    assert statement.startswith("CREATE OR REPLACE VIEW `c`.`s`.`v_products` (")
    assert "[NOT NULL]" in statement


def test_sql_string_escaping():
    assert sql_string("retailer's \\ id") == "'retailer\\'s \\\\ id'"


def test_render_placeholders():
    body = render("SELECT * FROM {{source}}.items JOIN {{pim}}.x", "`c`.`s`", {"pim": "main.pim"})
    assert body == "SELECT * FROM `c`.`s`.items JOIN `main`.`pim`.x"
    with pytest.raises(ValueError, match="Unknown adapter placeholder"):
        render("SELECT * FROM {{other}}.t", "`c`.`s`")
    with pytest.raises(ValueError, match="identifier"):
        render("SELECT * FROM {{pim}}.t", "`c`.`s`", {"pim": "x; DROP TABLE y"})
    with pytest.raises(ValueError, match="single SELECT"):
        render("SELECT 1; SELECT 2", "`c`.`s`")
    assert render("SELECT ';' AS x -- a; b\n", "`c`.`s`") == "SELECT ';' AS x -- a; b"


def test_mock_adapter_renders_and_returns_every_column():
    statements = view_statements(ADAPTERS, "mock", "`dev`.`erp`", "`dev`.`brickfill`")
    assert len(statements) == 3
    for contract, body in zip(VIEWS, load_adapter(ADAPTERS, "mock").values()):
        selected = {
            match.lower() for match in re.findall(r"\bAS\s+([a-z_]+)\s*(?:,|$)", body, re.IGNORECASE | re.MULTILINE)
        }
        assert set(contract.column_names) <= selected, contract.key


def test_template_adapter_declares_every_column():
    for contract in VIEWS:
        text = (ADAPTERS / "_template" / f"{contract.key}.sql").read_text()
        for column in contract.column_names:
            assert f"AS {column}" in text
    with pytest.raises(ValueError):
        load_adapter(ADAPTERS, "_template")


def test_schema_issues():
    described = [(c.name.upper(), c.type.lower()) for c in ATTRIBUTES.columns if c.name != "unit"]
    described = [(name, "string" if name == "SORT_ORDER" else kind) for name, kind in described]
    issues = {(issue.code, issue.column) for issue in schema_issues(ATTRIBUTES, described)}
    assert issues == {("MISSING_COLUMN", "unit"), ("WRONG_TYPE", "sort_order")}
    assert (
        schema_issues(ATTRIBUTES, [(c.name, "integer" if c.type == "INT" else c.type) for c in ATTRIBUTES.columns])
        == []
    )


def _sql_gtin_twin(g: str) -> bool:
    """Python transcription of gtin_valid_expression, to check the SQL formula against validate_gtin."""
    if not re.fullmatch(r"[0-9]{8}|[0-9]{12,14}", g):
        return False
    total = sum(int(g[len(g) - i - 1]) * (3 if i % 2 == 1 else 1) for i in range(1, len(g)))
    return (10 - total % 10) % 10 == int(g[-1])


def test_gtin_sql_formula_matches_python():
    samples = [gtin13("789123456789"), gtin14(gtin13("200000000001")), "96385074", "036000291452", "7891234567890"]
    for value in samples:
        assert _sql_gtin_twin(value) == validate_gtin(value), value
    assert "aggregate(sequence(1, length(gtin) - 1)" in gtin_valid_expression("gtin")


def test_data_checks_and_failure_policy():
    codes = {(check.view, check.code) for check in data_checks("`c`.`s`")}
    assert ("v_products", "GTIN_INVALID") in codes and ("v_attribute_options", "OPTION_ORPHAN_ATTRIBUTE") in codes
    assert ("v_attributes", "ENUM_INVALID") in codes
    results = [{"severity": "WARNING", "failing_rows": 3}, {"severity": "ERROR", "failing_rows": 0}]
    assert not should_fail(results)
    assert should_fail(results, "warning")
    assert not should_fail([{"severity": "ERROR", "failing_rows": 1}], "never")


def test_data_check_samples_use_no_subquery_alias():
    # The sample keys are read outside the check's subquery, where its aliases (a., p., o.) don't resolve.
    for check in data_checks("`c`.`s`"):
        outer = check.sql.split(" FROM ", 1)[0]
        assert not re.search(r"\b\w+\.\w+", outer), (check.code, outer)


def test_adapters_readme_is_current():
    assert (ADAPTERS / "README.md").read_text() == _script("export_contract_doc").render()
