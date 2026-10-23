from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from databricks.sdk import WorkspaceClient

from brickfill.content.models import MarketPack
from brickfill.mcp_client import DatabricksMCPClient
from brickfill.models import ProductSeed

NATIVE_WEB_SEARCH = "system.ai.web_search"
FIRECRAWL_SEARCH = "firecrawl_search"
FIRECRAWL_SEARCH_RESULTS = 10  # Firecrawl bills search in blocks of 10 results (2 credits), without page scraping

SOCIAL_DOMAINS = (
    "facebook.com",
    "instagram.com",
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "pinterest.com",
    "pinterest.com.br",
)

URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
TRACKING_PARAMETERS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "referrer",
    "source",
}


def _ascii(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().casefold()


def canonicalize_url(value: str) -> str | None:
    # A trailing backslash comes from JSON escaping in search results (e.g. Firecrawl search), never from the URL.
    candidate = value.strip().rstrip(".,;:!?)]}\\")
    try:
        parts = urlsplit(candidate)
    except ValueError:
        return None
    if parts.scheme.casefold() not in {"http", "https"} or not parts.netloc:
        return None
    query = [
        (key, item)
        for key, item in parse_qsl(parts.query, keep_blank_values=True)
        if not key.casefold().startswith("utm_")
        and not key.casefold().endswith("clid")
        and key.casefold() not in TRACKING_PARAMETERS
    ]
    path = parts.path or "/"
    if path != "/":
        path = path.rstrip("/")
    return urlunsplit((parts.scheme.casefold(), parts.netloc.casefold(), path, urlencode(query), ""))


def extract_urls(text: str) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for match in URL_PATTERN.findall(text):
        canonical = canonicalize_url(match)
        if canonical and canonical not in seen:
            seen.add(canonical)
            urls.append(canonical)
    return urls


def _candidate_score(url: str, seed: ProductSeed, position: int, market: MarketPack | None = None) -> tuple[int, int]:
    parts = urlsplit(url)
    host_and_path = _ascii(f"{parts.netloc} {parts.path}")
    brand_tokens = [token for token in re.findall(r"[a-z0-9]+", _ascii(seed.brand)) if len(token) >= 3]
    score = max(0, 20 - position)
    if seed.ean in url:
        score += 20
    if any(token in host_and_path for token in brand_tokens):
        score += 15
    # Source titles often start with the product name ("ACME X100 DRILL ..."); a page named after it is usually the
    # product page, even when the retailer has no brand column.
    title_token = _title_token(seed)
    if title_token and title_token in host_and_path:
        score += 10
    if parts.path.casefold().endswith(".pdf"):
        score += 5
    # Marketplaces of the market carry many sellers' listings; ranked below brand and retailer pages.
    netloc = parts.netloc.casefold()
    if market and any(domain.casefold() in netloc for domain in market.deprioritized_domains):
        score -= 5
    if market and any(domain.casefold() in netloc for domain in market.preferred_domains):
        score += 5
    # Social networks and videos rarely carry a citable spec sheet; ranked last so they do not spend scrape credits.
    host = (parts.hostname or "").casefold()
    if any(host == domain or host.endswith(f".{domain}") for domain in SOCIAL_DOMAINS):
        score -= 40
    return score, -position


@dataclass
class DiscoveryReport:
    queries: list[str] = field(default_factory=list)
    responses: list[str] = field(default_factory=list)
    candidate_urls: list[str] = field(default_factory=list)
    error: str | None = None
    provider: str = NATIVE_WEB_SEARCH

    def prompt_context(self, maximum_response_chars: int = 16000) -> str:
        if self.error:
            return f"{self.provider} unavailable in this attempt: {self.error}"
        sections: list[str] = []
        for index, (query, response) in enumerate(zip(self.queries, self.responses), start=1):
            sections.append(
                f"Query {index}: {query}\nDiscovery response (not evidence):\n{response[:maximum_response_chars]}"
            )
        sections.append("Canonical candidate URLs:\n" + "\n".join(self.candidate_urls))
        return "\n\n".join(sections)


def _search_title(title: str) -> str:
    """The source title as search words: separators become spaces and one-letter fragments ("P/") are dropped.

    Decimal marks between digits stay ("0,5L", "1.6 kg").
    """
    words = re.sub(r"[/&;:()]+|(?<!\d)[.,]|[.,](?!\d)", " ", title).split()
    return " ".join(word for word in words if not (len(word) == 1 and word.isalpha()))


def _title_token(seed: ProductSeed) -> str:
    """First word of the title long enough to identify the product in a URL (e.g. "acme")."""
    tokens = [token for token in re.findall(r"[a-z0-9]+", _ascii(seed.source_title)) if len(token) >= 4]
    return tokens[0] if tokens else ""


def build_discovery_queries(seed: ProductSeed) -> list[str]:
    """Two plain queries, as a person would type them: the EAN alone and the title words with the EAN.

    ERP titles are abbreviated ("DOG/CAT 150MG 10 TAB.ACME"): quoted as an exact phrase, with a list of extra keywords,
    they matched no page at all for some products, and the model was left guessing URLs.
    """
    product = " ".join(part for part in (_search_title(seed.source_title), seed.brand.strip(), seed.ean) if part)
    return [f'"{seed.ean}"', product]


async def discover_sources(
    seed: ProductSeed,
    workspace_client: WorkspaceClient,
    maximum_urls: int = 5,
    market: MarketPack | None = None,
) -> DiscoveryReport:
    queries = build_discovery_queries(seed)
    responses: list[str] = []
    async with DatabricksMCPClient("system.ai.web_search", workspace_client) as client:
        tools = await client.tools()
        if "web_search" not in {tool.name for tool in tools}:
            raise RuntimeError("system.ai.web_search did not publish the web_search tool")
        for query in queries:
            responses.append(await client.call("web_search", {"query": query}))
    return DiscoveryReport(
        queries=queries,
        responses=responses,
        candidate_urls=_rank_candidates(responses, seed, maximum_urls, market),
    )


def _rank_candidates(
    responses: list[str], seed: ProductSeed, maximum_urls: int, market: MarketPack | None = None
) -> list[str]:
    ordered_urls: list[str] = []
    for response in responses:
        ordered_urls.extend(url for url in extract_urls(response) if url not in ordered_urls)
    ranked = sorted(
        enumerate(ordered_urls),
        key=lambda item: _candidate_score(item[1], seed, item[0], market),
        reverse=True,
    )
    return [url for _, url in ranked[:maximum_urls]]


def search_arguments(query: str, properties: dict[str, Any], market: MarketPack | None = None) -> dict[str, Any]:
    """Arguments of one Firecrawl search: search results only (no scrapeOptions), one block of 10 results.

    With a market, the search is localized (``location``/``country``) when the tool's schema exposes those properties.
    """
    arguments: dict[str, Any] = {"query": query}
    if "limit" in properties:
        arguments["limit"] = FIRECRAWL_SEARCH_RESULTS
    if "sources" in properties:
        arguments["sources"] = ["web"]
    if market is not None:
        if "location" in properties and market.search_location:
            arguments["location"] = market.search_location
        if "country" in properties and market.country:
            arguments["country"] = market.country
    return arguments


def search_tool(tools: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [
        tool
        for tool in tools
        if "search" in str(tool.get("function", {}).get("name", "")).casefold()
        and "query" in tool.get("function", {}).get("parameters", {}).get("properties", {})
    ]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda tool: (tool["function"]["name"].casefold() != FIRECRAWL_SEARCH, len(tool["function"]["name"])),
    )


async def discover_sources_firecrawl(
    seed: ProductSeed,
    mcp: Any,
    tools: list[dict[str, Any]],
    maximum_urls: int = 5,
    market: MarketPack | None = None,
) -> DiscoveryReport:
    """Discovery without system.ai.web_search (e.g. Azure workspaces): the same queries through Firecrawl search.

    Only search results are requested (no scrapeOptions), so each query costs one block of search credits; the pages
    are scraped afterwards by the prefetch, which archives screenshots and crops.
    """
    tool = search_tool(tools)
    if tool is None:
        raise RuntimeError("The Firecrawl MCP did not publish the firecrawl_search tool")
    name = tool["function"]["name"]
    properties = tool["function"]["parameters"].get("properties", {})
    queries = build_discovery_queries(seed)
    responses = [await mcp.call(name, search_arguments(query, properties, market)) for query in queries]
    return DiscoveryReport(
        queries=queries,
        responses=responses,
        candidate_urls=_rank_candidates(responses, seed, maximum_urls, market),
        provider=FIRECRAWL_SEARCH,
    )
