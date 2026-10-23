"""Language-neutral validation issues: a stable code plus named params; the English message is only a fallback.

The app translates ``issues.<CODE>`` with the same params (i18next ``{{param}}``), so every code and param name here
is part of the contract with the app. Rows written before this module existed carry the legacy codes listed in
``LEGACY_CODES``; the app keeps translations for them.
"""

from __future__ import annotations

from typing import Any

from brickfill.models import Severity, ValidationIssue

TEMPLATES: dict[str, str] = {
    "INVALID_GTIN": "Invalid EAN/GTIN.",
    "BRAND_TITLE_CONFLICT": "The source brand does not appear in the source title; confirm it with a source.",
    "INVALID_LENGTH": "Field must have between {min} and {max} characters; received {actual}.",
    "FACT_SHEET_MISSING_GTIN": "The fact sheet must include the product GTIN.",
    "INVALID_ENRICHED_GTIN": "Cited GTIN has an invalid check digit: {candidate}.",
    "GTIN_LOGISTIC_RELATION_CONFLICT": (
        "Logistic GTIN {candidate} does not derive from the unit GTIN {unit}; expected {expected} for indicator "
        "{indicator}."
    ),
    "GTIN_PACKAGING_LEVEL_CONFLICT": "Code {candidate} was presented at the wrong packaging level ({level}).",
    "CATEGORY_REQUIRED_FACT": "Required fact for this category is missing from the fact sheet: {label}.",
    "TITLE_MISSING_BRAND": "The generated title must contain the verified brand.",
    "DESCRIPTION_LINK": "The short description must not contain links.",
    "META_SUFFIX": "Meta description must end with: {suffixes}.",
    "FAQ_COUNT": "FAQ must have between {min} and {max} questions when there is enough information; received {actual}.",
    "UNRESOLVED_SOURCE_CONFLICT": "Non-official sources disagree on {fact}; human review required.",
    "EMOJI": "Content must not contain emojis.",
    "PROMOTIONAL_LANGUAGE": "Forbidden promotional expression found: {term}.",
    "DUPLICATE_ATTRIBUTE": "Attribute returned more than once: {attribute}.",
    "MISSING_ATTRIBUTE_DEFINITION": "Attribute of the subcategory is missing from the result: {attribute}.",
    "UNKNOWN_ATTRIBUTE": "The agent returned an attribute that does not belong to the subcategory: {attribute}.",
    "VOCABULARY_VALUE_NOT_ALLOWED": "Value outside the allowed vocabulary for {attribute}: {value}.",
    "VOCABULARY_VALUE_PREAPPROVED": (
        "Out-of-vocabulary value for {attribute} published as pre-approved ({confidence}% confidence): {value}."
    ),
    "VOCABULARY_VALUE_PENDING": "Out-of-vocabulary candidate for {attribute} awaiting review: {value}.",
    "MISSING_REQUIRED_ATTRIBUTE": "Required attribute without a value: {attribute}.",
    "UNCITED_ATTRIBUTE": "Attribute filled without evidence: {attribute}.",
    "MISSING_ATTRIBUTE_OBSERVATION": "Attribute without a value must explain the absence in its observation: {attribute}.",
    "GENERIC_ATTRIBUTE_VALUE": "Generic value not allowed for {attribute}: {value}.",
    "NON_OFFICIAL_FAQ_SOURCE": "FAQ answers must cite official sources only: {url}.",
    "IMAGE_DIMENSIONS_UNKNOWN": "Image resolution could not be confirmed: {url}.",
    "IMAGE_RESOLUTION": "Image below {min_width}x{min_height}: {width}x{height}.",
    "IMAGE_BACKGROUND_UNVERIFIED": "White background of the image not confirmed.",
    "NO_IMAGE_CANDIDATE": "No product image was found in the sources consulted.",
    "VISUAL_EVIDENCE_INCOMPLETE": "Value of {attribute} has no unambiguous visual crop; human review required.",
    "AGENT_FAILURE": "The research agent failed: {error}",
}

# Codes found only in rows written before the rules became configurable.
LEGACY_CODES = {
    "META_ENDING": "META_SUFFIX",
    "ELECTRO_REQUIRED_FIELD": "CATEGORY_REQUIRED_FACT",
    "FACT_SHEET_MISSING_EAN": "FACT_SHEET_MISSING_GTIN",
}

# Reason codes of an attribute (``product_attribute.rejection_code`` / ``applicability_code``) and their English text.
REJECTION_REASONS: dict[str, str] = {
    "NO_EVIDENCE_FOR_CANDIDATE": "Candidate kept, but no extracted evidence supports the value.",
    "EVIDENCE_VALUE_MISMATCH": 'Candidate "{value}" differs from the cited source ({fact}: "{fact_value}").',
    "NOT_IN_VOCABULARY": 'Value "{value}" does not exactly match the allowed vocabulary.',
    "TAXONOMY_MISMATCH": 'Value "{value}" removed: a taxonomy attribute must match the product category exactly.',
}
APPLICABILITY_REASONS: dict[str, str] = {
    "CANDIDATE_NEEDS_REVIEW": "There is a candidate that needs human validation.",
    "EVIDENCE_FOUND": "The research found evidence for this attribute.",
    "REQUIRED_NO_EVIDENCE": "Required attribute without enough evidence.",
    "OPTIONAL_NO_CANDIDATE": "Optional attribute without a candidate or evidence for this product.",
    "NOT_IN_MATRIX": "Attribute does not belong to the subcategory or was marked as not applicable.",
}


def _format(template: str, params: dict[str, Any]) -> str:
    try:
        return template.format(**params)
    except (KeyError, IndexError, ValueError):
        return template


def make(code: str, severity: Severity, field: str, **params: str | float) -> ValidationIssue:
    """An issue with its English message rendered from :data:`TEMPLATES`."""
    if code not in TEMPLATES:
        raise KeyError(f"Unknown validation issue code {code!r}")
    clean = {name: value for name, value in params.items() if value is not None}
    return ValidationIssue(
        code=code, severity=severity, field=field, message=_format(TEMPLATES[code], clean), params=clean
    )


def rejection_reason(code: str, **params: Any) -> str:
    return _format(REJECTION_REASONS[code], params)


def applicability_reason(code: str) -> str:
    return APPLICABILITY_REASONS[code]
