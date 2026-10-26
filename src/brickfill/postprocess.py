from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime

from brickfill.content.loader import EffectiveRules, default_rules
from brickfill.issues import applicability_reason, rejection_reason
from brickfill.models import (
    AttributeDefinition,
    AttributeMappingStatus,
    CatalogAttribute,
    Fact,
    ProductEnrichment,
    ProductSeed,
    ResearchTrace,
    SourceTier,
)
from brickfill.research import canonicalize_url
from brickfill.text import search_key as _search_key

OUT_OF_VOCAB_PREAPPROVAL_CONFIDENCE = 0.8


def _truncate_at_word(text: str, maximum: int) -> str:
    if len(text) <= maximum:
        return text
    shortened = text[: maximum - 3].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return f"{shortened}..."


def _normalized_vocabulary_value(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return " ".join(normalized.split()).casefold()


def _without_parenthetical(value: str) -> str:
    return _search_key(re.sub(r"\s*\([^)]*\)\s*", " ", value))


def _quantity(value: str, default_unit: str = "", unit_aliases: dict[str, str] | None = None) -> tuple[str, str] | None:
    """Number and unit of a value such as "1,6 kg" or '6.7"'; a bare number takes ``default_unit``.

    The number keeps its digits as written, only with a decimal point: "1.000 W" (a thousand) never equals "1 W".
    Unit words map through ``unit_aliases`` (locale packs); the inch mark '"' has an empty search key, like "inch".
    """
    match = re.fullmatch(r"\s*([+-]?\d+(?:[.,]\d+)?)\s*([a-zA-ZÀ-ÿ\"]*)\s*", value)
    if not match:
        return None
    number = match.group(1).replace(",", ".")
    unit = _search_key(match.group(2)) if match.group(2) else default_unit
    aliases = unit_aliases or {}
    return number, aliases.get(unit, unit)


def _declared_unit(definition: AttributeDefinition, rules: EffectiveRules) -> str:
    """Unit of the attribute's numeric values: the ``unit`` column of the contract, else a unit stated in the name
    ("Height (in cm)", "Altura (em cm)"); its vocabulary then holds bare numbers."""
    aliases = rules.unit_aliases
    if definition.unit.strip():
        unit = _search_key(definition.unit)
        return aliases.get(unit, unit)
    for pattern in rules.declared_unit_patterns:
        match = pattern.search(definition.name)
        if match:
            unit = _search_key(match.group(1))
            return aliases.get(unit, unit)
    return ""


def _spelling_key(value: str) -> str:
    """Comparison key that ignores case, accents, spaces, hyphens and a trailing ".0" ("Android 14.0").

    Unlike ``_search_key`` it keeps every other symbol, so "FHD+" and "FHD", "1/2" and "12", "1.000" and "1" stay
    different values.
    """
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().casefold()
    ascii_value = re.sub(r"(\d)[.,]0(?!\d)", r"\1", ascii_value)
    return re.sub(r"[\s\-_]+", "", ascii_value)


def _same_value(candidate: str, value: str, definition: AttributeDefinition, rules: EffectiveRules) -> bool:
    """The same value up to spelling ("Frost-Free"), unit ("387 Litros" and "387 L", "77" and "77 cm" for a cm
    attribute) or a market equivalence ("110V" and "127V" in Brazil)."""
    if not candidate or not value:
        return False
    if _search_key(candidate) == _search_key(value) or _spelling_key(candidate) == _spelling_key(value):
        return True
    unit = _declared_unit(definition, rules)
    quantity = _quantity(candidate, unit, rules.unit_aliases)
    if quantity is not None and quantity == _quantity(value, unit, rules.unit_aliases):
        return True
    return rules.equivalent_values(candidate, value)


def _fact_supports(fact: Fact, candidate: str, definition: AttributeDefinition, rules: EffectiveRules) -> bool:
    return any(
        _same_value(candidate, value, definition, rules) for value in (fact.value, fact.normalized_value) if value
    )


BRAND_ROLES = {"brand", "manufacturer", "supplier"}


def _matching_facts(
    attribute_name: str, facts: list[Fact], requested_names: list[str], rules: EffectiveRules
) -> list[Fact]:
    requested = {_search_key(name) for name in requested_names if name}
    attribute_key = _search_key(attribute_name)
    aliases = rules.attribute_fact_aliases.get(attribute_key, {attribute_key})
    return [fact for fact in facts if _search_key(fact.name) in requested or _search_key(fact.name) in aliases]


def _is_brand_attribute(definition: AttributeDefinition, rules: EffectiveRules) -> bool:
    return definition.role in BRAND_ROLES or _search_key(definition.name) in rules.brand_attribute_keys


def _match_vocabulary(
    candidate: str,
    definition: AttributeDefinition,
    rules: EffectiveRules,
) -> tuple[str | None, AttributeMappingStatus, str | None]:
    """Value to publish, mapping status and rejection code (``NOT_IN_VOCABULARY``) of a candidate."""
    if not definition.vocabulary:
        return candidate, AttributeMappingStatus.FREE_TEXT, None

    exact = {_normalized_vocabulary_value(value): value for value in definition.vocabulary}
    if canonical := exact.get(_normalized_vocabulary_value(candidate)):
        return canonical, AttributeMappingStatus.EXACT, None

    # The same number and unit, written differently ("6,7\"" and '6.7"', "16,44 cm" for "Altura (em cm)").
    # Every match denotes the same quantity, so several spellings of it in the vocabulary are not ambiguous.
    unit = _declared_unit(definition, rules)
    aliases = rules.unit_aliases
    quantity = _quantity(candidate, unit, aliases)
    if quantity is not None:
        quantity_matches = [value for value in definition.vocabulary if _quantity(value, unit, aliases) == quantity]
        if quantity_matches:
            return quantity_matches[0], AttributeMappingStatus.APPROVED_ALIAS, None

    # The same text up to separators ("06868-24-00953" and "068682400953", "Android 14.0" and "Android 14"),
    # then without a trailing detail in parentheses ("FHD+ (1080x2400)" and "FHD+").
    for key in (_spelling_key(candidate), _spelling_key(re.sub(r"\s*\([^)]*\)\s*$", "", candidate))):
        spelling_matches = [value for value in definition.vocabulary if key and _spelling_key(value) == key]
        if spelling_matches:
            return spelling_matches[0], AttributeMappingStatus.APPROVED_ALIAS, None

    # A value the market treats as the same ("127V" for a "110V" option in Brazil).
    equivalent = [value for value in definition.vocabulary if rules.equivalent_values(candidate, value)]
    if len(equivalent) == 1:
        return equivalent[0], AttributeMappingStatus.APPROVED_ALIAS, None

    if _is_brand_attribute(definition, rules):
        candidate_alias = _without_parenthetical(candidate)
        brand_aliases = [value for value in definition.vocabulary if _without_parenthetical(value) == candidate_alias]
        if len(brand_aliases) == 1:
            return brand_aliases[0], AttributeMappingStatus.APPROVED_ALIAS, None

    if definition.allows_free_text:
        # the options are suggestions: a candidate outside them is published as written
        return candidate, AttributeMappingStatus.FREE_TEXT, None
    return None, AttributeMappingStatus.OUT_OF_VOCAB, "NOT_IN_VOCABULARY"


def _project_attributes(
    attributes: list[CatalogAttribute],
    facts: list[Fact],
    definitions: list[AttributeDefinition],
    rules: EffectiveRules,
) -> list[CatalogAttribute]:
    returned = {attribute.code: attribute for attribute in attributes}
    projected: list[CatalogAttribute] = []
    for definition in definitions:
        attribute = returned.get(definition.code) or CatalogAttribute(code=definition.code, name=definition.name)
        attribute.name = definition.name
        attribute.required = definition.required

        matched_facts = _matching_facts(attribute.name, facts, attribute.source_fact_names, rules)
        candidate = attribute.candidate_value or attribute.value
        if candidate is None and matched_facts:
            best_fact = max(matched_facts, key=lambda fact: fact.confidence)
            candidate = best_fact.normalized_value or best_fact.value

        conflicting_fact: Fact | None = None
        if candidate:
            same_value_facts = [fact for fact in matched_facts if _fact_supports(fact, candidate, definition, rules)]
            if not same_value_facts:
                # e.g. "Capacity" backed by the "Net capacity" fact of the same value
                same_value_facts = [fact for fact in facts if _fact_supports(fact, candidate, definition, rules)]
            if not same_value_facts and matched_facts:
                # A fact of this attribute states another value and none states the candidate: the evidence the
                # model cited is about that other value.
                conflicting_fact = max(matched_facts, key=lambda fact: fact.confidence)
            matched_facts = same_value_facts

        if conflicting_fact is not None:
            attribute.value = None
            attribute.candidate_value = candidate
            attribute.normalized_value = None
            attribute.applicable = True
            attribute.mapping_status = AttributeMappingStatus.CONFLICT
            attribute.confidence = 0.0
            _reject(
                attribute,
                "EVIDENCE_VALUE_MISMATCH",
                value=candidate,
                fact=conflicting_fact.name,
                fact_value=conflicting_fact.value,
            )
            _applicability(attribute, "CANDIDATE_NEEDS_REVIEW")
            attribute.observation = attribute.rejection_reason
            attribute.source_fact_names = [conflicting_fact.name]
            projected.append(attribute)
            continue

        evidence_urls = list(attribute.evidence_urls)
        for fact in matched_facts:
            evidence_urls.extend(evidence.url for evidence in fact.evidence)
        attribute.evidence_urls = list(dict.fromkeys(evidence_urls))
        attribute.source_fact_names = list(dict.fromkeys(fact.name for fact in matched_facts))
        attribute.candidate_value = candidate
        attribute.normalized_value = None
        attribute.rejection_reason = None
        attribute.rejection_code = None

        if candidate and not attribute.evidence_urls:
            attribute.value = None
            attribute.applicable = True
            attribute.mapping_status = AttributeMappingStatus.NO_EVIDENCE
            _reject(attribute, "NO_EVIDENCE_FOR_CANDIDATE")
            _applicability(attribute, "CANDIDATE_NEEDS_REVIEW")
            attribute.confidence = 0.0
        elif candidate:
            accepted, status, rejection = _match_vocabulary(candidate, definition, rules)
            if matched_facts:
                attribute.confidence = max(attribute.confidence, max(fact.confidence for fact in matched_facts))
            is_preapproved = (
                status == AttributeMappingStatus.OUT_OF_VOCAB
                and attribute.confidence >= OUT_OF_VOCAB_PREAPPROVAL_CONFIDENCE
            )
            published_value = candidate if is_preapproved else accepted
            attribute.value = published_value
            attribute.normalized_value = published_value
            attribute.mapping_status = status
            if rejection:
                _reject(attribute, rejection, value=candidate)
            attribute.applicable = True
            _applicability(attribute, "EVIDENCE_FOUND")
            if is_preapproved:
                attribute.observation = (
                    f"{attribute.rejection_reason} Published as pre-approved with {attribute.confidence:.0%} "
                    "confidence; subject to human review."
                )
            elif attribute.rejection_reason:
                attribute.observation = attribute.rejection_reason
        elif definition.required:
            attribute.value = None
            attribute.applicable = True
            attribute.mapping_status = AttributeMappingStatus.NO_EVIDENCE
            _applicability(attribute, "REQUIRED_NO_EVIDENCE")
            attribute.observation = attribute.observation or "No sufficient evidence was found."
            attribute.confidence = 0.0
        else:
            attribute.value = None
            attribute.applicable = False
            attribute.mapping_status = AttributeMappingStatus.NOT_APPLICABLE
            _applicability(attribute, "OPTIONAL_NO_CANDIDATE")
            attribute.observation = attribute.observation or attribute.applicability_reason
            attribute.confidence = 0.0
        projected.append(attribute)
    definition_codes = {definition.code for definition in definitions}
    for attribute in attributes:
        if attribute.code in definition_codes:
            continue
        if not attribute.applicable:
            attribute.value = None
            attribute.confidence = 0.0
            attribute.mapping_status = AttributeMappingStatus.NOT_APPLICABLE
            _applicability(attribute, "NOT_IN_MATRIX")
        projected.append(attribute)
    return projected


def _reject(attribute: CatalogAttribute, code: str, **params: str) -> None:
    attribute.rejection_code = code
    attribute.rejection_reason = rejection_reason(code, **params)


def _applicability(attribute: CatalogAttribute, code: str) -> None:
    attribute.applicability_code = code
    attribute.applicability_reason = applicability_reason(code)


def enforce_evidence_policy(
    result: ProductEnrichment,
    definitions: list[AttributeDefinition] | None = None,
    seed: ProductSeed | None = None,
    retrieved_at: datetime | None = None,
    discovered_urls: list[str] | None = None,
    scraped_urls: list[str] | None = None,
    web_search_queries: list[str] | None = None,
    discovery_error: str | None = None,
    discovery_provider: str = "system.ai.web_search",
    rules: EffectiveRules | None = None,
) -> ProductEnrichment:
    """Apply deterministic safety rules before validation and persistence."""
    rules = rules or default_rules()
    normalized = result.model_copy(deep=True)
    if rules.profile.short_description.truncate:
        normalized.short_description = _truncate_at_word(
            normalized.short_description, rules.profile.short_description.max_length
        )
    captured_at = retrieved_at or datetime.now(UTC)
    discovered = {url for value in (discovered_urls or []) if (url := canonicalize_url(value))}
    restrict_to_scraped = scraped_urls is not None
    scraped = {url for value in (scraped_urls or []) if (url := canonicalize_url(value))}

    normalized.research_trace = ResearchTrace(
        web_search_queries=web_search_queries or [],
        discovered_urls=sorted(discovered),
        scraped_urls=sorted(scraped),
        discovery_provider=discovery_provider,
        discovery_error=discovery_error,
    )

    retained_facts = []
    for fact in normalized.facts:
        retained_evidence = []
        for evidence in fact.evidence:
            canonical = canonicalize_url(str(evidence.url))
            if restrict_to_scraped and canonical not in scraped:
                continue
            evidence.retrieved_at = captured_at
            evidence.retrieval_provider = "firecrawl"
            evidence.discovery_provider = discovery_provider if canonical in discovered else None
            retained_evidence.append(evidence)
        if retained_evidence:
            fact.evidence = retained_evidence
            retained_facts.append(fact)
    normalized.facts = retained_facts

    official_urls = {
        str(evidence.url)
        for fact in normalized.facts
        for evidence in fact.evidence
        if evidence.source_tier == SourceTier.OFFICIAL
    }
    normalized.faq = [
        item
        for item in normalized.faq
        if item.source_urls and {str(url) for url in item.source_urls}.issubset(official_urls)
    ]

    for attribute in normalized.attributes:
        attribute.evidence_urls = [
            url for url in attribute.evidence_urls if not restrict_to_scraped or canonicalize_url(str(url)) in scraped
        ]
        if attribute.value and not attribute.evidence_urls:
            attribute.candidate_value = attribute.candidate_value or attribute.value
            if definitions is None:
                attribute.value = None
                attribute.confidence = 0.0
                attribute.observation = "Value removed automatically because no evidence URL was found."

    if definitions is not None:
        normalized.attributes = _project_attributes(normalized.attributes, normalized.facts, definitions, rules)

    if seed is not None:
        taxonomy_values = {
            _normalized_vocabulary_value(value)
            for value in (seed.department, seed.category, seed.subcategory)
            if value.strip()
        }
        roles = {definition.code: definition.role for definition in definitions or []}
        taxonomy_attribute_names = rules.taxonomy_attribute_keys
        for attribute in normalized.attributes:
            if not attribute.value:
                continue
            is_taxonomy = (
                roles.get(attribute.code) == "taxonomy" or _search_key(attribute.name) in taxonomy_attribute_names
            )
            if not is_taxonomy:
                continue
            if _normalized_vocabulary_value(attribute.value) not in taxonomy_values:
                rejected = attribute.value
                attribute.candidate_value = attribute.candidate_value or rejected
                attribute.value = None
                attribute.normalized_value = None
                attribute.mapping_status = AttributeMappingStatus.OUT_OF_VOCAB
                _reject(attribute, "TAXONOMY_MISMATCH", value=rejected)
                attribute.confidence = 0.0
                attribute.observation = attribute.rejection_reason

    normalized.images = [
        image
        for image in normalized.images
        if not restrict_to_scraped or canonicalize_url(str(image.source_url)) in scraped
    ]

    return normalized
