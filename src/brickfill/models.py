from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl, field_validator


class SourceTier(str, Enum):
    OFFICIAL = "official"
    AUTHORIZED_DISTRIBUTOR = "authorized_distributor"
    RECOGNIZED_RETAILER = "recognized_retailer"
    OTHER = "other"


class ProductSeed(BaseModel):
    """One product to enrich, read from the canonical ``v_products`` view (``ean`` holds the view's ``gtin``)."""

    source_title: str
    ean: str
    brand: str = ""
    category: str
    subcategory: str
    product_id: str = ""
    title_alt: str = ""
    supplier: str = ""
    department_id: str = ""
    department: str = ""
    category_id: str = ""
    subcategory_id: str = ""

    def for_model(self) -> str:
        """The product as the model sees it: the retailer's internal ids carry no information for the research."""
        return self.model_dump_json(exclude={"product_id", "department_id", "category_id", "subcategory_id"})


def parse_eans(value: str) -> list[str]:
    """One EAN or a comma/semicolon-separated list (the job's ``ean`` parameter), in order and without repetitions."""
    return list(dict.fromkeys(item.strip() for item in value.replace(";", ",").split(",") if item.strip()))


class AttributeDefinition(BaseModel):
    code: str
    name: str
    required: bool = False
    vocabulary: list[str] = Field(default_factory=list)
    description: str = ""
    value_type: str = "text"  # text | number | boolean | date
    unit: str = ""  # unit of numeric values ("cm", "g"); the vocabulary then holds bare numbers
    role: str = ""  # brand | manufacturer | supplier | model | color | size | taxonomy | other
    allows_free_text: bool = False  # with a vocabulary: the options are suggestions, not a closed list


class AttributeMappingStatus(str, Enum):
    EXACT = "EXACT"
    APPROVED_ALIAS = "APPROVED_ALIAS"
    FREE_TEXT = "FREE_TEXT"
    OUT_OF_VOCAB = "OUT_OF_VOCAB"
    NO_EVIDENCE = "NO_EVIDENCE"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    CONFLICT = "CONFLICT"


class Evidence(BaseModel):
    url: HttpUrl
    source_title: str = ""
    source_tier: SourceTier
    excerpt: str = Field(min_length=1, max_length=1200)
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    retrieval_provider: str = "firecrawl"
    discovery_provider: str | None = None


class VisualEvidence(BaseModel):
    evidence_id: str
    capture_id: str | None = None
    url: str
    final_url: str | None = None
    source_title: str = ""
    source_tier: str = ""
    fact_name: str | None = None
    fact_value: str | None = None
    excerpt: str = ""
    captured_at: datetime | None = None
    screenshot_path: str | None = None
    crop_path: str | None = None
    text_path: str | None = None
    coordinates_path: str | None = None
    crop_box: list[int] | None = None
    screenshot_sha256: str | None = None
    crop_sha256: str | None = None
    capture_status: str
    capture_error: str | None = None


class Fact(BaseModel):
    name: str
    value: str
    normalized_value: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: list[Evidence] = Field(min_length=1)


class CatalogAttribute(BaseModel):
    code: str
    # name and required come from the attribute definitions (postprocess); the model does not need to repeat them.
    name: str = ""
    value: str | None = None
    required: bool = False
    applicable: bool = True
    confidence: float = Field(default=0, ge=0, le=1)
    evidence_urls: list[HttpUrl] = Field(default_factory=list)
    observation: str | None = None
    candidate_value: str | None = None
    normalized_value: str | None = None
    mapping_status: AttributeMappingStatus | None = None
    source_fact_names: list[str] = Field(default_factory=list)
    rejection_reason: str | None = None
    applicability_reason: str | None = None
    # Language-neutral codes of the two reasons above (the app translates them; the text is the English fallback).
    rejection_code: str | None = None
    applicability_code: str | None = None
    visual_evidence: list[VisualEvidence] = Field(default_factory=list)


class LabelValue(BaseModel):
    label: str
    value: str


class FactSheetSection(BaseModel):
    name: str
    items: list[LabelValue] = Field(default_factory=list)


class FAQItem(BaseModel):
    question: str
    answer: str
    source_urls: list[HttpUrl] = Field(min_length=1)


class ImageCandidate(BaseModel):
    url: HttpUrl
    source_url: HttpUrl
    role: str = "gallery"
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    white_background: bool | None = None


OBSERVATION_HINT_LENGTH = 240


class ResearchTrace(BaseModel):
    web_search_queries: list[str] = Field(default_factory=list)
    discovered_urls: list[HttpUrl] = Field(default_factory=list)
    scraped_urls: list[HttpUrl] = Field(default_factory=list)
    discovery_provider: str = "system.ai.web_search"
    retrieval_provider: str = "firecrawl"
    discovery_error: str | None = None
    # Cost telemetry of the product, measured by the code (never by the model).
    model_endpoint: str | None = None
    model_calls: int = 0
    tool_steps: int = 0
    json_repairs: int = 0
    repair_errors: list[str] = Field(default_factory=list)
    dropped_items: list[str] = Field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    firecrawl_searches: int = 0
    firecrawl_credits: int = 0
    structured_output: bool = False  # repairs constrained to the catalog schema by the endpoint
    cache_write_input_tokens: int = 0
    follow_up_facts: int = 0  # facts added by the evidence follow-up for candidates left without evidence


class ProductEnrichment(BaseModel):
    ean: str
    verified_brand: str
    model: str | None = None
    supplier: str | None = None
    generated_title: str
    short_description: str
    meta_description: str
    fact_sheet: list[FactSheetSection]
    faq: list[FAQItem] = Field(default_factory=list)
    attributes: list[CatalogAttribute]
    facts: list[Fact]
    images: list[ImageCandidate] = Field(default_factory=list)
    research_summary: str
    research_trace: ResearchTrace = Field(default_factory=ResearchTrace)

    @field_validator("generated_title", "short_description", "meta_description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return " ".join(value.split())

    def json_for_storage(self) -> str:
        return self.model_dump_json(exclude_none=True)

    @classmethod
    def response_schema(cls) -> dict[str, Any]:
        schema = cls.model_json_schema()
        schema.get("properties", {}).pop("research_trace", None)
        evidence = schema.get("$defs", {}).get("Evidence", {})
        for field_name in ("retrieved_at", "retrieval_provider", "discovery_provider"):
            evidence.get("properties", {}).pop(field_name, None)
            if field_name in evidence.get("required", []):
                evidence["required"].remove(field_name)
        attribute = schema.get("$defs", {}).get("CatalogAttribute", {})
        for field_name in (
            "name",
            "required",
            "normalized_value",
            "mapping_status",
            "rejection_reason",
            "applicability_reason",
            "rejection_code",
            "applicability_code",
            "visual_evidence",
        ):
            attribute.get("properties", {}).pop(field_name, None)
            if field_name in attribute.get("required", []):
                attribute["required"].remove(field_name)
        # A hint for the model (and for endpoints that enforce it): long observations cost output tokens.
        for option in attribute.get("properties", {}).get("observation", {}).get("anyOf", []):
            if option.get("type") == "string":
                option["maxLength"] = OBSERVATION_HINT_LENGTH
        schema.get("$defs", {}).pop("VisualEvidence", None)
        return schema


class Severity(str, Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


class ValidationIssue(BaseModel):
    code: str
    severity: Severity
    field: str
    message: str  # English, for logs and as the fallback of the app's translation of ``code``
    params: dict[str, str | int | float] = Field(default_factory=dict)
