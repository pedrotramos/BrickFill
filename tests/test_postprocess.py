from __future__ import annotations

from conftest import OFFICIAL_URL, attribute, definition, fact, make_result

from brickfill.content.loader import effective_rules
from brickfill.models import AttributeMappingStatus
from brickfill.postprocess import enforce_evidence_policy


def project(result, definitions, **kwargs):
    return enforce_evidence_policy(result, definitions=definitions, **kwargs).attributes


def test_truncation_follows_profile():
    long = ("word " * 120).strip()
    assert len(enforce_evidence_policy(make_result(short_description=long)).short_description) <= 300
    rules = effective_rules(overrides={"short_description_min_length": 50, "short_description_max_length": 100})
    assert len(enforce_evidence_policy(make_result(short_description=long), rules=rules).short_description) <= 100


def test_unit_from_contract_column():
    definitions = [definition("10", "Height", unit="cm", vocabulary=["16.44", "20"])]
    result = make_result(attributes=[attribute("10", candidate_value="16,44 cm", evidence_urls=[OFFICIAL_URL])])
    projected = project(result, definitions)[0]
    assert (projected.value, projected.mapping_status) == ("16.44", AttributeMappingStatus.APPROVED_ALIAS)


def test_inch_unit_alias():
    definitions = [definition("11", "Screen Size", unit="in", vocabulary=["6.7", "6.1"])]
    result = make_result(attributes=[attribute("11", candidate_value='6,7"', evidence_urls=[OFFICIAL_URL])])
    assert project(result, definitions)[0].value == "6.7"


def test_brand_alias_by_role():
    definitions = [definition("1", "Fabricante X", role="brand", vocabulary=["Acme (Acme Tools)", "Other"])]
    result = make_result(attributes=[attribute("1", candidate_value="Acme", evidence_urls=[OFFICIAL_URL])])
    assert project(result, definitions)[0].value == "Acme (Acme Tools)"


def test_fact_alias_in_english():
    projected = project(make_result(facts=[fact("Net weight", "1.6 kg")]), [definition("2", "Weight")])[0]
    assert projected.value == "1.6 kg"
    assert projected.applicability_code == "EVIDENCE_FOUND"


def test_out_of_vocabulary_codes_and_free_text_options():
    definitions = [definition("4", "Color", vocabulary=["Blue", "Black"])]
    result = make_result(attributes=[attribute("4", candidate_value="Graphite", evidence_urls=[OFFICIAL_URL])])
    projected = project(result, definitions)[0]
    assert projected.rejection_code == "NOT_IN_VOCABULARY"
    assert projected.mapping_status == AttributeMappingStatus.OUT_OF_VOCAB
    assert "Graphite" in projected.rejection_reason
    definitions = [definition("4", "Color", vocabulary=["Blue", "Black"], allows_free_text=True)]
    projected = project(result, definitions)[0]
    assert (projected.value, projected.mapping_status) == ("Graphite", AttributeMappingStatus.FREE_TEXT)


def test_taxonomy_guard_by_role(seed):
    definitions = [definition("3", "Aisle", role="taxonomy")]
    result = make_result(attributes=[attribute("3", "Carton", evidence_urls=[OFFICIAL_URL])])
    projected = enforce_evidence_policy(result, definitions=definitions, seed=seed).attributes[0]
    assert projected.value is None
    assert projected.rejection_code == "TAXONOMY_MISMATCH"
    result = make_result(attributes=[attribute("3", "Drills", evidence_urls=[OFFICIAL_URL])])
    assert enforce_evidence_policy(result, definitions=definitions, seed=seed).attributes[0].value == "Drills"


def test_reason_codes_without_evidence():
    definitions = [definition("5", "Material", required=True), definition("6", "Finish")]
    result = make_result(attributes=[attribute("5", candidate_value="Steel")])
    by_code = {item.code: item for item in project(result, definitions)}
    assert by_code["5"].rejection_code == "NO_EVIDENCE_FOR_CANDIDATE"
    assert by_code["5"].applicability_code == "CANDIDATE_NEEDS_REVIEW"
    assert by_code["6"].applicability_code == "OPTIONAL_NO_CANDIDATE"
    assert by_code["6"].mapping_status == AttributeMappingStatus.NOT_APPLICABLE


def test_evidence_restricted_to_scraped_urls():
    result = make_result(facts=[fact("Power", "750 W"), fact("Weight", "2 kg", url="https://other.example.org/x")])
    kept = enforce_evidence_policy(result, scraped_urls=["https://brand.example.com/products/drill-x100"])
    assert [item.name for item in kept.facts] == ["Power"]


def test_value_search_compares_value_and_normalized_value():
    # Seen in a real run: fact "387 Litros" normalized to "387 L", candidate "387 Litros" left without evidence.
    facts = [fact("Net capacity", "387 Litros").model_copy(update={"normalized_value": "387 L"})]
    result = make_result(facts=facts, attributes=[attribute("20", candidate_value="387 Litros")])
    assert project(result, [definition("20", "Capacity")])[0].source_fact_names == ["Net capacity"]


def test_value_search_matches_quantities_with_unit_aliases():
    # "Capacity" has no fact of its own; "Net capacity" states the same quantity with another spelling of the unit.
    rules = effective_rules(content_language="pt-BR")
    facts = [fact("Capacidade Líquida", "387 Litros")]
    result = make_result(facts=facts, attributes=[attribute("20", candidate_value="387 L")])
    projected = project(result, [definition("20", "Capacidade")], rules=rules)[0]
    assert projected.value == "387 L"
    assert [str(url) for url in projected.evidence_urls] == [OFFICIAL_URL]
    assert projected.source_fact_names == ["Capacidade Líquida"]


def test_declared_unit_makes_bare_number_and_quantity_equal():
    facts = [fact("Depth", "77").model_copy(update={"normalized_value": "77 cm"})]
    result = make_result(facts=facts, attributes=[attribute("33", candidate_value="77", source_fact_names=["Depth"])])
    projected = project(result, [definition("33", "Depth", unit="cm")])[0]
    assert (projected.value, [str(url) for url in projected.evidence_urls]) == ("77", [OFFICIAL_URL])


def test_candidate_contradicted_by_its_own_fact_goes_to_review():
    result = make_result(
        facts=[fact("Model", "X100A")],
        attributes=[attribute("74", candidate_value="X100", source_fact_names=["Model"], evidence_urls=[OFFICIAL_URL])],
    )
    projected = project(result, [definition("74", "Model")])[0]
    assert projected.value is None
    assert projected.mapping_status == AttributeMappingStatus.CONFLICT
    assert projected.rejection_code == "EVIDENCE_VALUE_MISMATCH"
    assert projected.applicability_code == "CANDIDATE_NEEDS_REVIEW"
    assert "X100A" in projected.rejection_reason


def test_market_value_equivalence():
    definitions = [definition("2", "Voltage", vocabulary=["110V", "220V"])]
    result = make_result(attributes=[attribute("2", candidate_value="127V", evidence_urls=[OFFICIAL_URL])])
    assert project(result, definitions, rules=effective_rules(market="BR"))[0].value == "110V"
    assert project(result, definitions, rules=effective_rules(market="US"))[0].value is None
