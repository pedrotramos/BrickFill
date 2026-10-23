from __future__ import annotations

import re
from collections import Counter

from brickfill.content.loader import EffectiveRules, default_rules
from brickfill.issues import make
from brickfill.models import (
    AttributeDefinition,
    AttributeMappingStatus,
    ProductEnrichment,
    ProductSeed,
    Severity,
    SourceTier,
    ValidationIssue,
)
from brickfill.text import contains_fragment, contains_term, search_key

EMOJI_PATTERN = re.compile("[\U0001f300-\U0001faff\U00002600-\U000027bf]")


def validate_gtin(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if len(digits) not in {8, 12, 13, 14}:
        return False
    body, expected = digits[:-1], int(digits[-1])
    total = sum(int(ch) * (3 if index % 2 == 0 else 1) for index, ch in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == expected


def gtin14_for_unit(gtin13: str, packaging_indicator: str = "1") -> str | None:
    digits = re.sub(r"\D", "", gtin13)
    if len(digits) != 13 or not validate_gtin(digits) or not packaging_indicator.isdigit():
        return None
    body = packaging_indicator + digits[:-1]
    total = sum(int(ch) * (3 if index % 2 == 0 else 1) for index, ch in enumerate(reversed(body)))
    return body + str((10 - total % 10) % 10)


class _Issues(list):
    """Collects issues, applying the profile's disabled rules and severity overrides in one place."""

    def __init__(self, rules: EffectiveRules) -> None:
        super().__init__()
        self.disabled = set(rules.profile.disabled_rules)
        self.severities = rules.profile.severity_overrides

    def add(self, code: str, severity: Severity, field: str, **params) -> None:
        if code in self.disabled:
            return
        if code in self.severities:
            severity = Severity(self.severities[code])
        self.append(make(code, severity, field, **params))


def _seed_issues(seed: ProductSeed, rules: EffectiveRules, issues: _Issues) -> None:
    if not validate_gtin(seed.ean):
        issues.add("INVALID_GTIN", Severity.ERROR, "ean")
    if (
        rules.profile.brand_must_appear_in_source_title
        and seed.brand
        and seed.brand.casefold() not in seed.source_title.casefold()
    ):
        issues.add("BRAND_TITLE_CONFLICT", Severity.WARNING, "brand")


def validate_seed(seed: ProductSeed, rules: EffectiveRules | None = None) -> list[ValidationIssue]:
    issues = _Issues(rules or default_rules())
    _seed_issues(seed, rules or default_rules(), issues)
    return list(issues)


def validate_enrichment(
    seed: ProductSeed,
    result: ProductEnrichment,
    definitions: list[AttributeDefinition] | None = None,
    rules: EffectiveRules | None = None,
) -> list[ValidationIssue]:
    rules = rules or default_rules()
    profile = rules.profile
    issues = _Issues(rules)
    _seed_issues(seed, rules, issues)

    def length_rule(field: str, text: str, minimum: int, maximum: int) -> None:
        if not minimum <= len(text) <= maximum:
            issues.add("INVALID_LENGTH", Severity.ERROR, field, min=minimum, max=maximum, actual=len(text))

    length_rule("generated_title", result.generated_title, 1, profile.title.max_length)
    length_rule(
        "short_description",
        result.short_description,
        profile.short_description.min_length,
        profile.short_description.max_length,
    )
    length_rule(
        "meta_description",
        result.meta_description,
        profile.meta_description.min_length,
        profile.meta_description.max_length,
    )

    fact_sheet_items = [item for section in result.fact_sheet for item in section.items]
    fact_sheet_labels = search_key(" | ".join(item.label for item in fact_sheet_items))
    fact_sheet_values = " ".join(item.value for item in fact_sheet_items)
    if profile.fact_sheet.must_include_gtin and seed.ean not in fact_sheet_values:
        issues.add("FACT_SHEET_MISSING_GTIN", Severity.ERROR, "fact_sheet")

    logistic_terms = rules.packaging_terms("logistic")
    unit_terms = rules.packaging_terms("unit")
    seen_gtin_issues: set[tuple[str, str]] = set()
    for fact in result.facts:
        context = search_key(f"{fact.name} {fact.value}")
        is_logistic = any(contains_fragment(context, term) for term in logistic_terms)
        is_unit = any(contains_fragment(context, term) for term in unit_terms)
        for candidate in re.findall(r"(?<!\d)\d{8,14}(?!\d)", fact.value):
            if len(candidate) not in {8, 12, 13, 14}:
                continue
            if not validate_gtin(candidate):
                key = ("INVALID_ENRICHED_GTIN", candidate)
                if key not in seen_gtin_issues:
                    seen_gtin_issues.add(key)
                    issues.add(key[0], Severity.ERROR, f"fact.{fact.name}", candidate=candidate)
            expected_logistic_gtin = gtin14_for_unit(seed.ean, candidate[0]) if len(candidate) == 14 else None
            if is_logistic and expected_logistic_gtin and candidate != expected_logistic_gtin:
                key = ("GTIN_LOGISTIC_RELATION_CONFLICT", candidate)
                if key not in seen_gtin_issues:
                    seen_gtin_issues.add(key)
                    issues.add(
                        key[0],
                        Severity.ERROR,
                        f"fact.{fact.name}",
                        candidate=candidate,
                        unit=seed.ean,
                        expected=expected_logistic_gtin,
                        indicator=candidate[0],
                    )
            if is_logistic and not is_unit and len(candidate) == 13:
                issues.add(
                    "GTIN_PACKAGING_LEVEL_CONFLICT",
                    Severity.ERROR,
                    f"fact.{fact.name}",
                    candidate=candidate,
                    level="logistic",
                )
            if is_unit and not is_logistic and len(candidate) == 14:
                issues.add(
                    "GTIN_PACKAGING_LEVEL_CONFLICT",
                    Severity.ERROR,
                    f"fact.{fact.name}",
                    candidate=candidate,
                    level="unit",
                )

    for label_key in rules.required_fact_labels(seed):
        if not any(contains_term(fact_sheet_labels, term) for term in rules.fact_label_terms(label_key)):
            issues.add(
                "CATEGORY_REQUIRED_FACT", Severity.ERROR, "fact_sheet", label=rules.fact_label_display(label_key)
            )

    if profile.title.require_brand and result.verified_brand.casefold() not in result.generated_title.casefold():
        issues.add("TITLE_MISSING_BRAND", Severity.ERROR, "generated_title")

    short = result.short_description.casefold()
    if profile.short_description.forbid_links and ("http://" in short or "https://" in short):
        issues.add("DESCRIPTION_LINK", Severity.ERROR, "short_description")

    suffixes = profile.meta_description.required_suffixes
    if suffixes and not result.meta_description.endswith(tuple(suffixes)):
        issues.add("META_SUFFIX", Severity.ERROR, "meta_description", suffixes=" / ".join(suffixes))

    if profile.faq.enabled and result.faq and not profile.faq.min <= len(result.faq) <= profile.faq.max:
        issues.add(
            "FAQ_COUNT", Severity.WARNING, "faq", min=profile.faq.min, max=profile.faq.max, actual=len(result.faq)
        )

    facts_by_name: dict[str, list] = {}
    for fact in result.facts:
        facts_by_name.setdefault(" ".join(fact.name.split()).casefold(), []).append(fact)
    for facts in facts_by_name.values():
        values = {" ".join(fact.value.split()).casefold() for fact in facts}
        has_official_source = any(
            evidence.source_tier == SourceTier.OFFICIAL for fact in facts for evidence in fact.evidence
        )
        if len(values) > 1 and not has_official_source:
            issues.add("UNRESOLVED_SOURCE_CONFLICT", Severity.ERROR, f"fact.{facts[0].name}", fact=facts[0].name)

    combined = f"{result.generated_title} {result.short_description} {result.meta_description}"
    if profile.forbid_emojis and EMOJI_PATTERN.search(combined):
        issues.add("EMOJI", Severity.ERROR, "content")
    combined_key = search_key(combined)
    for term in rules.promotional_terms:
        if contains_term(combined_key, term):
            issues.add("PROMOTIONAL_LANGUAGE", Severity.ERROR, "content", term=term)

    duplicate_codes = [code for code, count in Counter(item.code for item in result.attributes).items() if count > 1]
    for code in duplicate_codes:
        issues.add("DUPLICATE_ATTRIBUTE", Severity.ERROR, f"attribute.{code}", attribute=code)

    if definitions is not None:
        expected = {item.code: item for item in definitions}
        returned = {item.code: item for item in result.attributes}
        for code, definition in expected.items():
            if code not in returned:
                issues.add(
                    "MISSING_ATTRIBUTE_DEFINITION", Severity.ERROR, f"attribute.{code}", attribute=definition.name
                )
        for code in returned.keys() - expected.keys():
            issues.add(
                "UNKNOWN_ATTRIBUTE", Severity.WARNING, f"attribute.{code}", attribute=returned[code].name or code
            )

        for code, attribute in returned.items():
            definition = expected.get(code)
            if (
                not definition
                or not definition.vocabulary
                or definition.allows_free_text
                or not attribute.value
                or attribute.mapping_status == AttributeMappingStatus.OUT_OF_VOCAB
            ):
                continue
            allowed = {" ".join(value.split()).casefold() for value in definition.vocabulary}
            if " ".join(attribute.value.split()).casefold() not in allowed:
                issues.add(
                    "VOCABULARY_VALUE_NOT_ALLOWED",
                    Severity.ERROR,
                    f"attribute.{code}",
                    attribute=definition.name,
                    value=attribute.value,
                )

    generic_values = rules.generic_value_keys
    for attribute in result.attributes:
        name = attribute.name or attribute.code
        if attribute.mapping_status == AttributeMappingStatus.OUT_OF_VOCAB:
            if attribute.value and attribute.evidence_urls:
                issues.add(
                    "VOCABULARY_VALUE_PREAPPROVED",
                    Severity.WARNING,
                    f"attribute.{attribute.code}",
                    attribute=name,
                    value=attribute.value,
                    confidence=round(attribute.confidence * 100),
                )
            else:
                issues.add(
                    "VOCABULARY_VALUE_PENDING",
                    Severity.WARNING,
                    f"attribute.{attribute.code}",
                    attribute=name,
                    value=attribute.candidate_value or "",
                )
        if attribute.required and attribute.applicable and not attribute.value:
            issues.add("MISSING_REQUIRED_ATTRIBUTE", Severity.ERROR, f"attribute.{attribute.code}", attribute=name)
        if attribute.value and not attribute.evidence_urls:
            issues.add("UNCITED_ATTRIBUTE", Severity.ERROR, f"attribute.{attribute.code}", attribute=name)

        if attribute.applicable and not attribute.value and not attribute.observation:
            issues.add("MISSING_ATTRIBUTE_OBSERVATION", Severity.WARNING, f"attribute.{attribute.code}", attribute=name)

        if attribute.value and search_key(attribute.value) in generic_values:
            issues.add(
                "GENERIC_ATTRIBUTE_VALUE",
                Severity.ERROR,
                f"attribute.{attribute.code}",
                attribute=name,
                value=attribute.value,
            )

    official_urls = {
        str(evidence.url)
        for fact in result.facts
        for evidence in fact.evidence
        if evidence.source_tier == SourceTier.OFFICIAL
    }
    for index, faq in enumerate(result.faq):
        faq_urls = {str(url) for url in faq.source_urls}
        if profile.faq.official_sources_only and (not faq_urls or not faq_urls.issubset(official_urls)):
            outside = sorted(faq_urls - official_urls)
            issues.add("NON_OFFICIAL_FAQ_SOURCE", Severity.ERROR, f"faq.{index}", url=", ".join(outside))

    images = profile.images
    for index, image in enumerate(result.images):
        if image.width is None or image.height is None:
            issues.add("IMAGE_DIMENSIONS_UNKNOWN", Severity.WARNING, f"images.{index}", url=str(image.url))
        elif image.width < images.min_width or image.height < images.min_height:
            issues.add(
                "IMAGE_RESOLUTION",
                Severity.WARNING,
                f"images.{index}",
                width=image.width,
                height=image.height,
                min_width=images.min_width,
                min_height=images.min_height,
            )
        if images.check_white_background and image.white_background is not True:
            issues.add("IMAGE_BACKGROUND_UNVERIFIED", Severity.WARNING, f"images.{index}")

    if images.required and not result.images:
        issues.add("NO_IMAGE_CANDIDATE", Severity.ERROR, "images")

    return list(issues)


def quality_score(result: ProductEnrichment, issues: list[ValidationIssue]) -> float:
    """Score current published data without letting non-blocking alerts dominate the result."""
    # The app explains these weights and deductions (app/brickfill/client/src/components/QualityInfo.tsx and the
    # qualityInfo texts in client/src/i18n/locales/*/common.json); update them together.
    required = [item for item in result.attributes if item.required and item.applicable]
    filled_required = [item for item in required if item.value and item.evidence_urls]
    required_coverage = len(filled_required) / len(required) if required else 1.0

    relevant = [
        item for item in result.attributes if item.applicable and (item.required or item.candidate_value or item.value)
    ]
    published = [item for item in relevant if item.value and item.evidence_urls]
    published_coverage = len(published) / len(relevant) if relevant else 1.0
    confidence = sum(item.confidence for item in published) / len(published) if published else 0.0

    tier_score = {
        SourceTier.OFFICIAL: 1.0,
        SourceTier.AUTHORIZED_DISTRIBUTOR: 0.9,
        SourceTier.RECOGNIZED_RETAILER: 0.75,
        SourceTier.OTHER: 0.5,
    }
    fact_source_scores = [
        max((tier_score[evidence.source_tier] for evidence in fact.evidence), default=0.0) for fact in result.facts
    ]
    source_quality = sum(fact_source_scores) / len(fact_source_scores) if fact_source_scores else 0.0

    base_score = 0.35 * required_coverage + 0.25 * published_coverage + 0.20 * source_quality + 0.20 * confidence
    critical_codes = {
        "INVALID_GTIN",
        "INVALID_ENRICHED_GTIN",
        "GTIN_LOGISTIC_RELATION_CONFLICT",
        "GTIN_PACKAGING_LEVEL_CONFLICT",
        "UNRESOLVED_SOURCE_CONFLICT",
        "UNCITED_ATTRIBUTE",
        "GENERIC_ATTRIBUTE_VALUE",
        "MISSING_REQUIRED_ATTRIBUTE",
        "MISSING_ATTRIBUTE_DEFINITION",
    }
    critical_errors = sum(issue.severity == Severity.ERROR and issue.code in critical_codes for issue in issues)
    other_errors = sum(issue.severity == Severity.ERROR and issue.code not in critical_codes for issue in issues)
    penalized_warnings = sum(
        issue.severity == Severity.WARNING and issue.code != "VOCABULARY_VALUE_PREAPPROVED" for issue in issues
    )
    penalty = min(0.40, 0.10 * critical_errors) + min(0.12, 0.03 * other_errors) + min(0.05, 0.005 * penalized_warnings)
    return round(max(0.0, min(1.0, base_score - penalty)), 4)
