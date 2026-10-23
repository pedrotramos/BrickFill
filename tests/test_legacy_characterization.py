"""Characterization of the rules the project shipped with (a Brazilian retailer's editorial policy).

These tests pin the behaviour before the rules became configurable: the same checks must still fire when the
"legacy" profile below is configured. Codes renamed by the refactor are mapped in ``RENAMED``.
"""

from __future__ import annotations

from conftest import EAN, OFFICIAL_URL, attribute, definition, fact, make_result

from brickfill.content.loader import effective_rules, load_profile
from brickfill.content.models import CategoryMatch, CategoryRule
from brickfill.models import AttributeMappingStatus, Severity
from brickfill.postprocess import enforce_evidence_policy
from brickfill.quality import gtin14_for_unit, quality_score, validate_enrichment, validate_gtin

RENAMED = {
    "META_ENDING": "META_SUFFIX",
    "ELECTRO_REQUIRED_FIELD": "CATEGORY_REQUIRED_FACT",
    "FACT_SHEET_MISSING_EAN": "FACT_SHEET_MISSING_GTIN",
}

LEGACY_PROFILE = load_profile("default").model_copy(
    update={
        "id": "legacy",
        "title": load_profile("default").title.model_copy(update={"max_length": 125}),
        "short_description": load_profile("default").short_description.model_copy(
            update={"min_length": 150, "max_length": 250}
        ),
        "meta_description": load_profile("default").meta_description.model_copy(
            update={"min_length": 70, "max_length": 150, "required_suffixes": ["Confira agora!", "Compre agora"]}
        ),
        "images": load_profile("default").images.model_copy(update={"min_width": 1500, "min_height": 1500}),
        "brand_must_appear_in_source_title": True,
        "category_rules": [
            CategoryRule(
                match=CategoryMatch(category_names=["eletro", "eletrodomésticos"]),
                required_fact_labels=["warranty", "height", "width", "depth", "weight"],
            )
        ],
    }
)
LEGACY = effective_rules(LEGACY_PROFILE, content_language="pt-BR", catalog_language="pt-BR", market="BR")

PT_SHORT = (
    "A furadeira de impacto Acme X100 tem 750 W para furar madeira, metal e alvenaria, com mandril de aperto "
    "rápido e velocidade variável, ideal para reformas e reparos em casa."
)
PT_META = "Furadeira de impacto Acme X100 com 750 W e velocidade variável para todo trabalho. Confira agora!"


def _code(name: str) -> str:
    return RENAMED.get(name, name)


def validate(seed, result, definitions=None):
    return validate_enrichment(seed, result, definitions, rules=LEGACY)


def enforce(result, **kwargs):
    return enforce_evidence_policy(result, rules=LEGACY, **kwargs)


def legacy_result(**overrides):
    values = {"short_description": PT_SHORT, "meta_description": PT_META}
    values.update(overrides)
    return make_result(**values)


def codes(issues):
    return {issue.code for issue in issues}


def test_clean_legacy_result_has_no_errors(seed):
    issues = validate(seed, legacy_result())
    assert [issue for issue in issues if issue.severity == Severity.ERROR] == []


def test_meta_suffix_required(seed):
    issues = validate(
        seed, legacy_result(meta_description="Furadeira Acme X100 com 750 W e velocidade variável para todo trabalho.")
    )
    assert _code("META_ENDING") in codes(issues)


def test_lengths(seed):
    issues = validate(seed, legacy_result(generated_title="Acme " + "x" * 130, short_description="Curta demais Acme."))
    fields = {issue.field for issue in issues if issue.code == "INVALID_LENGTH"}
    assert fields == {"generated_title", "short_description"}


def test_fact_sheet_must_include_ean(seed):
    result = legacy_result()
    result.fact_sheet[0].items = [item for item in result.fact_sheet[0].items if item.value != EAN]
    assert _code("FACT_SHEET_MISSING_EAN") in codes(validate(seed, result))


def test_electro_category_requires_dimensions(seed):
    electro = seed.model_copy(update={"category": "Eletro"})
    found = [issue for issue in validate(electro, legacy_result()) if issue.code == _code("ELECTRO_REQUIRED_FIELD")]
    assert len(found) == 5


def test_promotional_and_generic_values(seed):
    result = legacy_result(short_description=PT_SHORT + " Imperdível!")
    assert "PROMOTIONAL_LANGUAGE" in codes(validate(seed, result))
    result = legacy_result(attributes=[attribute("1", "Várias cores", evidence_urls=[OFFICIAL_URL], name="Cor")])
    assert "GENERIC_ATTRIBUTE_VALUE" in codes(validate(seed, result))


def test_logistic_gtin_terms(seed):
    wrong = gtin14_for_unit("7899999999999", "1")  # valid GTIN-14 that does not derive from the unit EAN
    assert wrong and validate_gtin(wrong)
    result = legacy_result(facts=[fact("Código da caixa master", wrong)])
    found = codes(validate(seed, result))
    assert "GTIN_LOGISTIC_RELATION_CONFLICT" in found or "INVALID_ENRICHED_GTIN" in found
    result = legacy_result(facts=[fact("EAN da caixa", EAN)])
    assert "GTIN_PACKAGING_LEVEL_CONFLICT" in codes(validate(seed, result))


def test_image_resolution_threshold(seed):
    result = legacy_result()
    result.images[0].width = 1200
    assert "IMAGE_RESOLUTION" in codes(validate(seed, result))


def test_gtin_check_digit():
    assert validate_gtin(EAN)
    assert not validate_gtin("7891234567890")


def test_postprocess_truncates_short_description():
    result = legacy_result(short_description=("palavra " * 60).strip())
    assert len(enforce(result).short_description) <= 250


def test_postprocess_quantity_alias_and_declared_unit():
    definitions = [definition("10", "Altura (em cm)", vocabulary=["16.44", "20"])]
    result = legacy_result(attributes=[attribute("10", candidate_value="16,44 cm", evidence_urls=[OFFICIAL_URL])])
    projected = enforce(result, definitions=definitions).attributes[0]
    assert projected.value == "16.44"
    assert projected.mapping_status == AttributeMappingStatus.APPROVED_ALIAS


def test_postprocess_brand_alias_and_fact_alias():
    definitions = [definition("1", "Marca", vocabulary=["Acme (Acme Tools)", "Other"])]
    result = legacy_result(attributes=[attribute("1", candidate_value="Acme", evidence_urls=[OFFICIAL_URL])])
    assert enforce(result, definitions=definitions).attributes[0].value == "Acme (Acme Tools)"
    definitions = [definition("2", "Peso")]
    result = legacy_result(facts=[fact("Peso líquido", "1,6 kg")])
    projected = enforce(result, definitions=definitions).attributes[0]
    assert projected.value == "1,6 kg"


def test_postprocess_taxonomy_guard(seed):
    definitions = [definition("3", "Departamento")]
    result = legacy_result(attributes=[attribute("3", "Caixa", evidence_urls=[OFFICIAL_URL])])
    projected = enforce(result, definitions=definitions, seed=seed).attributes[0]
    assert projected.value is None
    assert projected.mapping_status == AttributeMappingStatus.OUT_OF_VOCAB


def test_out_of_vocabulary_preapproval(seed):
    definitions = [definition("4", "Cor", vocabulary=["Azul", "Preto"])]
    result = legacy_result(
        attributes=[attribute("4", candidate_value="Grafite", evidence_urls=[OFFICIAL_URL], confidence=0.9)]
    )
    projected = enforce(result, definitions=definitions)
    assert projected.attributes[0].value == "Grafite"
    issues = validate(seed, projected, definitions)
    assert "VOCABULARY_VALUE_PREAPPROVED" in codes(issues)
    assert 0 < quality_score(projected, issues) <= 1
