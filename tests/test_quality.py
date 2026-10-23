from __future__ import annotations

from conftest import EAN, OFFICIAL_URL, attribute, fact, make_result

from brickfill.content.loader import effective_rules, load_profile
from brickfill.content.models import CategoryMatch, CategoryRule
from brickfill.issues import TEMPLATES
from brickfill.models import Severity
from brickfill.quality import quality_score, validate_enrichment


def codes(issues):
    return {issue.code for issue in issues}


def test_default_profile_has_no_suffix_rule(seed, result):
    issues = validate_enrichment(seed, result)
    assert "META_SUFFIX" not in codes(issues)
    assert [issue for issue in issues if issue.severity == Severity.ERROR] == []


def test_suffix_rule_only_when_configured(seed, result):
    rules = effective_rules(overrides={"meta_description_required_suffixes": ["Shop now!"]})
    issues = validate_enrichment(seed, result, rules=rules)
    suffix = next(issue for issue in issues if issue.code == "META_SUFFIX")
    assert suffix.params == {"suffixes": "Shop now!"}


def test_lengths_follow_overrides_and_carry_params(seed):
    result = make_result(generated_title="Impact Drill Acme X100 750 W with Keyless Chuck and Case")
    rules = effective_rules(overrides={"title_max_length": 40})
    issue = next(i for i in validate_enrichment(seed, result, rules=rules) if i.code == "INVALID_LENGTH")
    assert issue.field == "generated_title"
    assert issue.params == {"min": 1, "max": 40, "actual": len(result.generated_title)}


def _category_rules(language: str):
    profile = load_profile().model_copy(
        update={
            "category_rules": [
                CategoryRule(match=CategoryMatch(category_ids=["64"]), required_fact_labels=["warranty", "weight"])
            ]
        }
    )
    return effective_rules(profile, content_language=language)


def test_category_required_fact_matches_localized_labels(seed, result):
    seed = seed.model_copy(update={"category_id": "64"})
    issues = validate_enrichment(seed, result, rules=_category_rules("en"))
    labels = {issue.params["label"] for issue in issues if issue.code == "CATEGORY_REQUIRED_FACT"}
    assert labels == {"warranty", "weight"}

    result.fact_sheet[0].items.append(result.fact_sheet[0].items[0].model_copy(update={"label": "Garantia"}))
    issues = validate_enrichment(seed, result, rules=_category_rules("pt-BR"))
    labels = {issue.params["label"] for issue in issues if issue.code == "CATEGORY_REQUIRED_FACT"}
    assert labels == {"peso"}


def test_category_rule_ignores_other_categories(seed, result):
    assert "CATEGORY_REQUIRED_FACT" not in codes(validate_enrichment(seed, result, rules=_category_rules("en")))


def test_promotional_terms_per_language_and_accent_insensitive(seed):
    result = make_result(short_description=make_result().short_description + " Unbeatable!")
    assert "PROMOTIONAL_LANGUAGE" in codes(validate_enrichment(seed, result))
    result = make_result(short_description=make_result().short_description + " Imperdivel!")
    assert "PROMOTIONAL_LANGUAGE" not in codes(validate_enrichment(seed, result))
    pt = effective_rules(content_language="pt-BR")
    issue = next(i for i in validate_enrichment(seed, result, rules=pt) if i.code == "PROMOTIONAL_LANGUAGE")
    assert issue.params == {"term": "imperdível"}


def test_generic_values_union_of_content_and_catalog_languages(seed):
    result = make_result(attributes=[attribute("1", "Cores variadas", evidence_urls=[OFFICIAL_URL], name="Color")])
    assert "GENERIC_ATTRIBUTE_VALUE" not in codes(validate_enrichment(seed, result))
    rules = effective_rules(content_language="en", catalog_language="pt-BR")
    assert "GENERIC_ATTRIBUTE_VALUE" in codes(validate_enrichment(seed, result, rules=rules))


def test_packaging_terms_in_english(seed):
    result = make_result(facts=[fact("Case GTIN", EAN)])
    issue = next(i for i in validate_enrichment(seed, result) if i.code == "GTIN_PACKAGING_LEVEL_CONFLICT")
    assert issue.params == {"candidate": EAN, "level": "logistic"}


def test_disabled_rules_and_severity_overrides(seed):
    result = make_result(images=[])
    assert "NO_IMAGE_CANDIDATE" in codes(validate_enrichment(seed, result))
    profile = load_profile().model_copy(
        update={"disabled_rules": ["NO_IMAGE_CANDIDATE"], "severity_overrides": {"TITLE_MISSING_BRAND": "WARNING"}}
    )
    rules = effective_rules(profile)
    result = make_result(images=[], generated_title="Impact Drill X100 750 W")
    issues = validate_enrichment(seed, result, rules=rules)
    assert "NO_IMAGE_CANDIDATE" not in codes(issues)
    assert next(i for i in issues if i.code == "TITLE_MISSING_BRAND").severity == Severity.WARNING


def test_brand_title_conflict_is_a_profile_rule(seed):
    seed = seed.model_copy(update={"brand": "Other"})
    assert "BRAND_TITLE_CONFLICT" not in codes(validate_enrichment(seed, make_result()))
    profile = load_profile().model_copy(update={"brand_must_appear_in_source_title": True})
    assert "BRAND_TITLE_CONFLICT" in codes(validate_enrichment(seed, make_result(), rules=effective_rules(profile)))


def test_every_issue_has_an_english_message_and_known_code(seed):
    result = make_result(
        generated_title="x",
        images=[],
        attributes=[attribute("9", "N/A", name="Size", required=True)],
        facts=[fact("Case code", "1234567890123")],
    )
    issues = validate_enrichment(seed, result)
    assert issues
    for issue in issues:
        assert issue.code in TEMPLATES
        assert issue.message and "{" not in issue.message


def test_quality_score_penalizes_critical_errors(seed, result):
    clean = quality_score(result, validate_enrichment(seed, result))
    broken = make_result(attributes=[attribute("1", "Blue", name="Color")])
    assert quality_score(broken, validate_enrichment(seed, broken)) < clean
