from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import openai
from databricks.sdk import WorkspaceClient
from pydantic import BaseModel, ValidationError

from brickfill.content.loader import EffectiveRules, default_rules
from brickfill.mcp_client import FirecrawlMCPClient
from brickfill.models import (
    AttributeDefinition,
    CatalogAttribute,
    Evidence,
    Fact,
    FactSheetSection,
    FAQItem,
    ImageCandidate,
    ProductEnrichment,
    ProductSeed,
)
from brickfill.postprocess import enforce_evidence_policy
from brickfill.prompt import (
    ALREADY_EXTRACTED,
    REPAIR_EMPTY,
    REPAIR_TRUNCATED,
    build_system_prompt,
    build_user_prompt,
    evidence_follow_up,
    external,
    repair_invalid,
    unknown_tool,
)
from brickfill.prompt import over_limit as over_limit_message
from brickfill.research import (
    FIRECRAWL_SEARCH,
    NATIVE_WEB_SEARCH,
    DiscoveryReport,
    canonicalize_url,
    discover_sources,
    discover_sources_firecrawl,
    search_arguments,
    search_tool,
)
from brickfill.visual_evidence import CaptureCollector

# Characters of each page sent to the model (prefetch and tool results alike); the full payload stays archived.
MAX_PAGE_CHARS = 30000
# Characters of a search result sent to the model (10 results with title and description).
MAX_SEARCH_CHARS = 8000
PAGE_METADATA = ("title", "description", "url", "sourceURL", "ogImage", "og:image")
# Output limit of the evidence follow-up: a few facts with short excerpts.
FOLLOW_UP_MAX_TOKENS = 4000


def _extract_json(text: str) -> dict[str, Any]:
    value = text.strip()
    if value.startswith("```"):
        value = value.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    start = value.find("{")
    if start < 0:
        raise ValueError(f"Model response did not contain a JSON object: {value[:200]!r}")
    # The first complete object is the answer; models sometimes add a note (with braces) after it, which used to
    # break the parse and cost a full-length repair.
    document, _end = json.JSONDecoder().raw_decode(value[start:])  # starts at "{", so always an object
    return document


def _page_document(payload: str) -> dict[str, Any] | None:
    """The scraped page inside a tool payload (``{"content": [{"text": "<page JSON>"}]}``), if there is one."""
    try:
        document = json.loads(payload)
        text = "\n".join(str(item.get("text", "")) for item in document.get("content", []) if isinstance(item, dict))
        page = json.loads(text)
    except (json.JSONDecodeError, AttributeError, TypeError):
        return None
    return page if isinstance(page, dict) else None


def _http_error(payload: str) -> int | None:
    """HTTP status of a scraped page when it is an error (404, 500...): such a page is not a source."""
    page = _page_document(payload)
    status = ((page or {}).get("metadata") or {}).get("statusCode")
    return status if isinstance(status, int) and status >= 400 else None


def _tool_result_succeeded(payload: str) -> bool:
    try:
        if json.loads(payload).get("is_error"):
            return False
    except (json.JSONDecodeError, AttributeError):
        return False
    # a 404 page comes back as a normal scrape (with the site menu): it must not become a citable source
    return _http_error(payload) is None


def _page_for_model(payload: str) -> str:
    """The part of a scrape result the model needs: markdown plus title, URL, description and main image.

    Tool payloads wrap the page in JSON twice (escaping every quote and line break) and carry the full metadata of the
    page; sending the plain markdown keeps the same content in fewer tokens.
    """
    try:
        document = json.loads(payload)
        if document.get("is_error"):
            texts = [str(item.get("text", "")) for item in document.get("content", []) if isinstance(item, dict)]
            return ("Extraction failed: " + " ".join(texts))[:1000]
        status = _http_error(payload)
        if status is not None:
            # the error page (often tens of thousands of characters of menu) is not sent to the model
            metadata = (_page_document(payload) or {}).get("metadata") or {}
            url = metadata.get("url") or metadata.get("sourceURL") or ""
            return f"Extraction failed: the page answered HTTP {status} ({url}). It is not a source; do not cite it."
        text = "\n".join(str(item.get("text", "")) for item in document.get("content", []) if isinstance(item, dict))
    except (json.JSONDecodeError, AttributeError):
        return payload[:MAX_PAGE_CHARS]
    try:
        page = json.loads(text)
    except json.JSONDecodeError:
        return text[:MAX_PAGE_CHARS]
    if not isinstance(page, dict) or "markdown" not in page:
        return text[:MAX_PAGE_CHARS]
    metadata = page.get("metadata") or {}
    lines = [f"{name}: {metadata[name]}" for name in PAGE_METADATA if metadata.get(name)]
    return ("\n".join(lines) + "\n\n" + str(page.get("markdown") or ""))[:MAX_PAGE_CHARS]


LIST_ITEMS: dict[str, type[BaseModel]] = {
    "facts": Fact,
    "attributes": CatalogAttribute,
    "fact_sheet": FactSheetSection,
    "faq": FAQItem,
    "images": ImageCandidate,
}


def _keep_valid_items(document: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Drop the list items that fail validation instead of regenerating the whole answer.

    One invalid item (a fact without evidence, a relative image URL, an excerpt over the limit) used to reject the full
    JSON and cost a repair that regenerates every output token. Dropping it is what the evidence policy would do anyway:
    a fact without valid evidence is not kept, and an attribute that is dropped is recorded as missing by the code.
    """

    def problem(exc: ValidationError) -> str:
        error = exc.errors()[0]
        return f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"

    dropped: list[str] = []
    cleaned = dict(document)
    for name, model in LIST_ITEMS.items():
        items = cleaned.get(name)
        if not isinstance(items, list):
            continue
        kept: list[Any] = []
        for index, item in enumerate(items):
            if name == "facts" and isinstance(item, dict) and isinstance(item.get("evidence"), list):
                evidence = []
                for position, entry in enumerate(item["evidence"]):
                    try:
                        Evidence.model_validate(entry)
                        evidence.append(entry)
                    except ValidationError as exc:
                        dropped.append(f"facts[{index}].evidence[{position}] {problem(exc)}")
                item = {**item, "evidence": evidence}
            try:
                model.model_validate(item)
                kept.append(item)
            except ValidationError as exc:
                dropped.append(f"{name}[{index}] {problem(exc)}")
        cleaned[name] = kept
    return cleaned, dropped


def _scrape_tool(tools: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = []
    for tool in tools:
        function = tool.get("function", {})
        name = str(function.get("name", ""))
        properties = function.get("parameters", {}).get("properties", {})
        if "scrape" in name.casefold() and "url" in properties:
            candidates.append(tool)
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda tool: (
            tool["function"]["name"].casefold() not in {"scrape", "firecrawl_scrape"},
            len(tool["function"]["name"]),
        ),
    )


def _model_scrape_tool(name: str) -> dict[str, Any]:
    """The scrape tool as the model sees it: only the URL and an optional render wait.

    Firecrawl's own MCP schema carries formats, actions and JSON extraction (more credits, thousands of tokens per
    call) and JSON Schema keys such as ``$schema``/``propertyNames`` that Gemini rejects with HTTP 400. The capture
    collector fixes the formats anyway, so the model never needs them.
    """
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": "Extracts the content of a web page (markdown) with Firecrawl.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full URL of the page to extract"},
                    "waitFor": {
                        "type": "integer",
                        "description": "Optional: milliseconds to wait for pages rendered by JavaScript",
                    },
                },
                "required": ["url"],
            },
        },
    }


def _model_search_tool(name: str) -> dict[str, Any]:
    """The search tool as the model sees it: only the query (the code fixes 10 web results, without scraping).

    Without it, a product whose discovery found nothing left the model guessing URLs from memory: each guess cost a
    scrape credit and most were 404 pages.
    """
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": (
                "Searches the web with Firecrawl and returns URLs, titles and descriptions (not evidence; extract the "
                "page with the scrape tool before citing it)."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Query, as typed in a search engine"}},
                "required": ["query"],
            },
        },
    }


def _search_for_model(payload: str) -> str:
    return "Search result (discovery only, not evidence):\n" + payload[:MAX_SEARCH_CHARS]


def _response_format(name: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}}


def _candidates_without_evidence(enriched: ProductEnrichment) -> list[CatalogAttribute]:
    return [item for item in enriched.attributes if item.rejection_code == "NO_EVIDENCE_FOR_CANDIDATE"]


def _rejects_chat_tools(exc: Exception) -> bool:
    """GPT 6.1 Sol refuses function tools in /v1/chat/completions and asks for the Responses API."""
    text = str(exc).casefold()
    return "/v1/responses" in text and "tool" in text


def _responses_request(arguments: dict[str, Any]) -> dict[str, Any]:
    """A Chat Completions request rewritten for the Responses API (same history, tools and output limit)."""
    items: list[dict[str, Any]] = []
    for message in arguments["messages"]:
        if message["role"] == "tool":
            items.append(
                {"type": "function_call_output", "call_id": message["tool_call_id"], "output": message["content"]}
            )
            continue
        text = _message_text(message.get("content"))
        if text:
            items.append({"role": message["role"], "content": text})
        for call in message.get("tool_calls") or []:
            items.append(
                {
                    "type": "function_call",
                    "call_id": call["id"],
                    "name": call["function"]["name"],
                    "arguments": call["function"]["arguments"],
                }
            )
    request: dict[str, Any] = {
        "model": arguments["model"],
        "input": items,
        "max_output_tokens": arguments["max_tokens"],
    }
    if arguments.get("tools"):
        request["tools"] = [{"type": "function", **tool["function"]} for tool in arguments["tools"]]
        request["tool_choice"] = arguments.get("tool_choice", "auto")
    return request


class _ResponsesMessage:
    """The assistant turn of a Responses API answer, read by the loop like a Chat Completions message."""

    def __init__(self, content: str | None, calls: list[dict[str, Any]]) -> None:
        self.content = content
        self._calls = calls
        self.tool_calls = [
            SimpleNamespace(id=call["id"], function=SimpleNamespace(**call["function"])) for call in calls
        ] or None

    def model_dump(self, **_kwargs: Any) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant", "content": self.content}
        if self._calls:
            message["tool_calls"] = self._calls
        return message


def _chat_response(response: Any) -> Any:
    """A Responses API answer as the Chat Completions response the agent loop reads."""
    text = ""
    calls: list[dict[str, Any]] = []
    for item in response.output or []:
        if item.type == "message":
            text += "".join(part.text for part in item.content or [] if getattr(part, "type", "") == "output_text")
        elif item.type == "function_call":
            calls.append(
                {"id": item.call_id, "type": "function", "function": {"name": item.name, "arguments": item.arguments}}
            )
    incomplete = getattr(getattr(response, "incomplete_details", None), "reason", None)
    usage = getattr(response, "usage", None)
    details = getattr(usage, "input_tokens_details", None)
    choice = SimpleNamespace(
        message=_ResponsesMessage(text or None, calls),
        finish_reason="length" if incomplete == "max_output_tokens" else "stop",
    )
    return SimpleNamespace(
        choices=[choice],
        usage=SimpleNamespace(
            prompt_tokens=getattr(usage, "input_tokens", 0) or 0,
            completion_tokens=getattr(usage, "output_tokens", 0) or 0,
            prompt_tokens_details=SimpleNamespace(cached_tokens=getattr(details, "cached_tokens", 0) or 0),
        ),
    )


def _attribute_prompt_payload(
    definitions: list[AttributeDefinition], vocabulary_limit: int = 50
) -> list[dict[str, Any]]:
    payload = []
    for item in definitions:
        entry: dict[str, Any] = {
            "code": item.code,
            "name": item.name,
            "required": item.required,
            "vocabulary_size": len(item.vocabulary),
            "controlled_vocabulary": bool(item.vocabulary) and not item.allows_free_text,
            "vocabulary": item.vocabulary if len(item.vocabulary) <= vocabulary_limit else [],
        }
        # optional contract columns, sent only when the retailer filled them
        if item.description:
            entry["description"] = item.description
        if item.unit:
            entry["unit"] = item.unit
        if item.value_type and item.value_type != "text":
            entry["value_type"] = item.value_type
        payload.append(entry)
    return payload


def _message_text(content: Any) -> str:
    """Text of a model message: a string, or a list of parts (Gemini returns text parts with a thought signature)."""
    if isinstance(content, list):
        return "".join(
            str(part.get("text", "")) if isinstance(part, dict) else str(getattr(part, "text", "") or "")
            for part in content
        )
    return content or ""


def _rejects_temperature(exc: Exception) -> bool:
    return "temperature" in str(exc).casefold() and "support" in str(exc).casefold()


def _compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _usage_value(usage: Any, *names: str) -> int:
    """First integer usage field found (Claude reports cache reads apart; OpenAI-style models in the details)."""
    for name in names:
        current = usage
        for part in name.split("."):
            current = current.get(part) if isinstance(current, dict) else getattr(current, part, None)
        if isinstance(current, int):
            return current
    return 0


class CatalogResearchAgent:
    def __init__(
        self,
        model_endpoint: str,
        mcp_url: str,
        api_key: str,
        max_steps: int = 3,
        max_json_repairs: int = 2,
        max_output_tokens: int = 32000,
        max_prefetch_urls: int = 5,
        capture_collector: CaptureCollector | None = None,
        use_native_web_search: bool = False,
    ) -> None:
        self.model_endpoint = model_endpoint
        self.mcp_url = mcp_url
        self.api_key = api_key
        self.max_steps = max_steps
        self.max_json_repairs = max_json_repairs
        self.max_output_tokens = max_output_tokens
        self.max_prefetch_urls = max_prefetch_urls
        self.capture_collector = capture_collector
        self.use_native_web_search = use_native_web_search
        self.send_temperature = True
        self.workspace = WorkspaceClient()
        self.openai = self.workspace.serving_endpoints.get_open_ai_client()

    async def _discover(
        self, seed: ProductSeed, mcp: FirecrawlMCPClient, tools: list[dict[str, Any]], rules: EffectiveRules
    ) -> DiscoveryReport:
        # system.ai.web_search is not available in Azure workspaces; the default (False) uses Firecrawl search.
        native = getattr(self, "use_native_web_search", False)
        try:
            if native:
                return await discover_sources(
                    seed, self.workspace, maximum_urls=self.max_prefetch_urls, market=rules.market
                )
            return await discover_sources_firecrawl(
                seed, mcp, tools, maximum_urls=self.max_prefetch_urls, market=rules.market
            )
        except Exception as exc:  # noqa: BLE001 - discovery failure must fall back to the Firecrawl tools
            return DiscoveryReport(
                error=f"{type(exc).__name__}: {str(exc)[:500]}",
                provider=NATIVE_WEB_SEARCH if native else FIRECRAWL_SEARCH,
            )

    async def _call_tool(self, mcp: FirecrawlMCPClient, name: str, arguments: dict[str, Any]) -> str:
        collector = getattr(self, "capture_collector", None)
        if collector is not None and "scrape" in name.casefold() and "url" in arguments:
            return await collector.scrape(arguments)
        return await mcp.call(name, arguments)

    async def _prefetch_sources(
        self,
        mcp: FirecrawlMCPClient,
        tools: list[dict[str, Any]],
        candidate_urls: list[str],
    ) -> tuple[list[str], set[str]]:
        tool = _scrape_tool(tools)
        if tool is None:
            return [], set()
        name = tool["function"]["name"]
        properties = tool["function"]["parameters"].get("properties", {})
        urls = candidate_urls[: self.max_prefetch_urls]

        async def scrape(url: str) -> str:
            arguments: dict[str, Any] = {"url": url}
            if "formats" in properties:
                arguments["formats"] = ["markdown"]
            return await self._call_tool(mcp, name, arguments)

        # in parallel (the Firecrawl slots of the run bound them), kept in ranking order
        results = await asyncio.gather(*(scrape(url) for url in urls))
        outputs: list[str] = []
        scraped_urls: set[str] = set()
        for url, result in zip(urls, results):
            outputs.append(f"Requested URL: {url}\nFirecrawl result:\n{external(_page_for_model(result))}")
            if _tool_result_succeeded(result):
                canonical = canonicalize_url(url)
                if canonical:
                    scraped_urls.add(canonical)
        return outputs, scraped_urls

    @property
    def _caches_prompts(self) -> bool:
        # Claude endpoints cache the prompt up to each cache_control block and read it at a tenth of the input price.
        # Other models (e.g. Gemini) cache implicitly and get plain text.
        return self.model_endpoint.startswith("databricks-claude")

    def _cached(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The history to send, with a cache breakpoint on its last user or tool message.

        The first user message (instructions and prefetched pages) keeps its own breakpoint; this second, moving one
        caches the tool results and repairs too, which every later call of the product would otherwise pay in full.
        The stored history is not changed, so the breakpoints never pile up (Claude accepts at most four).
        """
        last = messages[-1]
        if not self._caches_prompts or len(messages) <= 2 or last["role"] not in {"user", "tool"}:
            return messages
        if not isinstance(last.get("content"), str):
            return messages
        marked = {
            **last,
            "content": [{"type": "text", "text": last["content"], "cache_control": {"type": "ephemeral"}}],
        }
        return [*messages[:-1], marked]

    def _user_message(self, text: str) -> dict[str, Any]:
        if self._caches_prompts:
            return {"role": "user", "content": [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]}
        return {"role": "user", "content": text}

    async def _respond(self, arguments: dict[str, Any]) -> Any:
        # No temperature: the models that need this API are reasoning models.
        response = await asyncio.to_thread(self.openai.responses.create, **_responses_request(arguments))
        return _chat_response(response)

    async def _complete(self, arguments: dict[str, Any]) -> Any:
        if getattr(self, "use_responses", False):
            return await self._respond(arguments)
        # Newer models (e.g. Claude Haiku 5.5, Gemini 3.8 Flash) reject temperature: dropped on the first refusal.
        if getattr(self, "send_temperature", True):
            arguments["temperature"] = 0.1
        # The client is synchronous: run it in a thread so the other products keep running meanwhile.
        try:
            return await asyncio.to_thread(self.openai.chat.completions.create, **arguments)
        except openai.BadRequestError as exc:
            if _rejects_chat_tools(exc):
                # e.g. GPT 6.1 Sol: function tools only through the Responses API; the next calls go there directly
                self.use_responses = True
                arguments.pop("temperature", None)
                return await self._respond(arguments)
            if "temperature" not in arguments or not _rejects_temperature(exc):
                raise
            self.send_temperature = False
            arguments.pop("temperature")
            return await asyncio.to_thread(self.openai.chat.completions.create, **arguments)

    async def check_model(self) -> None:
        """One tiny call shaped like the real ones (tool declared) before any paid Firecrawl request.

        An endpoint that rejects the request (unsupported parameter or tool schema) then fails the run in seconds,
        instead of after every product's searches and scrapes were paid for.
        """
        await self._complete(
            {
                "model": self.model_endpoint,
                "messages": [{"role": "user", "content": "Answer only: ok"}],
                "max_tokens": 64,
                "tools": [_model_scrape_tool("firecrawl_scrape"), _model_search_tool("firecrawl_search")],
                "tool_choice": "auto",
            }
        )
        self.structured_output = await self._accepts_response_format()

    async def _accepts_response_format(self) -> bool:
        """Whether the endpoint constrains an answer to the catalog schema (``response_format``, strict JSON schema).

        Then the final answer is always valid JSON and never regenerated by a repair. Endpoints that refuse the
        parameter (or the schema) keep the free-text answer with repairs.
        """
        if getattr(self, "use_responses", False):
            return False
        try:
            await self._complete(
                {
                    "model": self.model_endpoint,
                    "messages": [{"role": "user", "content": "Answer only: {}"}],
                    "max_tokens": 16,
                    "response_format": _response_format("product_enrichment", ProductEnrichment.response_schema()),
                }
            )
        except openai.BadRequestError as exc:
            print(f"Structured output unavailable on {self.model_endpoint}: {str(exc)[:200]}")
            return False
        return True

    def system_prompt(self, rules: EffectiveRules) -> str:
        """One prompt per rules combination (cached): identical text keeps the model's prompt cache warm."""
        cache = self.__dict__.setdefault("_system_prompts", {})
        if rules.hash not in cache:
            cache[rules.hash] = build_system_prompt(rules)
        return cache[rules.hash]

    async def enrich(
        self, seed: ProductSeed, definitions: list[AttributeDefinition], rules: EffectiveRules | None = None
    ) -> ProductEnrichment:
        rules = rules or default_rules()
        attribute_payload = _attribute_prompt_payload(definitions)
        slots = getattr(getattr(self, "capture_collector", None), "slots", None)
        structured = getattr(self, "structured_output", False)
        async with FirecrawlMCPClient(self.mcp_url, self.api_key, slots) as mcp:
            available_tools = await mcp.openai_tools()
            discovery = await self._discover(seed, mcp, available_tools, rules)
            prefetched_pages, scraped_urls = await self._prefetch_sources(
                mcp,
                available_tools,
                discovery.candidate_urls,
            )
            # Only minimal scrape and search tools are offered: crawl, extract, agent and the like spend many credits
            # and add thousands of tokens of tool definitions to every call.
            scrape_tool = _scrape_tool(available_tools)
            tools = [_model_scrape_tool(scrape_tool["function"]["name"])] if scrape_tool else []
            found_search = search_tool(available_tools)
            search_name = found_search["function"]["name"] if found_search else None
            if found_search:
                tools.append(_model_search_tool(search_name))
            allowed = {tool["function"]["name"] for tool in tools}
            model_searches = 0
            user_prompt = build_user_prompt(
                seed_json=seed.for_model(),
                attributes_json=_compact(attribute_payload),
                discovery_provider=discovery.provider,
                discovery_context=discovery.prompt_context(),
                prefetched_pages=prefetched_pages,
                max_steps=self.max_steps,
                response_schema=_compact(ProductEnrichment.response_schema()),
                required_fact_labels=[rules.fact_label_display(key) for key in rules.required_fact_labels(seed)],
            )
            messages: list[dict[str, Any]] = [
                {"role": "system", "content": self.system_prompt(rules)},
                self._user_message(user_prompt),
            ]
            usage = {
                "model_calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cached_input_tokens": 0,
                "cache_write_input_tokens": 0,
            }
            tool_steps = 0
            json_repairs = 0
            repair_errors: list[str] = []
            # After a failed answer, the repair is constrained to the schema when the endpoint supports it, so one repair
            # always yields valid JSON. Only then: the endpoint does not accept response_format with tools, and a call
            # without the tools misses the prompt cache (tool definitions are part of the cached prefix).
            final_requested = False

            async def call(history: list[dict[str, Any]], **extra: Any) -> Any:
                response = await self._complete(
                    {
                        "model": self.model_endpoint,
                        "messages": self._cached(history),
                        "max_tokens": self.max_output_tokens,
                        **extra,
                    }
                )
                usage["model_calls"] += 1
                reported = getattr(response, "usage", None)
                if reported is not None:
                    usage["input_tokens"] += _usage_value(reported, "prompt_tokens")
                    usage["output_tokens"] += _usage_value(reported, "completion_tokens")
                    usage["cached_input_tokens"] += _usage_value(
                        reported, "cache_read_input_tokens", "prompt_tokens_details.cached_tokens"
                    )
                    usage["cache_write_input_tokens"] += _usage_value(reported, "cache_creation_input_tokens")
                return response

            def finish(result: ProductEnrichment, dropped: list[str], follow_up_facts: int = 0) -> ProductEnrichment:
                enriched = enforce_evidence_policy(
                    result,
                    definitions=definitions,
                    seed=seed,
                    retrieved_at=datetime.now(UTC),
                    discovered_urls=discovery.candidate_urls,
                    scraped_urls=sorted(scraped_urls),
                    web_search_queries=discovery.queries,
                    discovery_error=discovery.error,
                    discovery_provider=discovery.provider,
                    rules=rules,
                )
                enriched.research_trace = enriched.research_trace.model_copy(
                    update={
                        **usage,
                        "model_endpoint": self.model_endpoint,
                        "tool_steps": tool_steps,
                        "json_repairs": json_repairs,
                        "repair_errors": repair_errors,
                        "dropped_items": dropped,
                        "firecrawl_searches": model_searches
                        + (len(discovery.responses) if discovery.provider == FIRECRAWL_SEARCH else 0),
                        "structured_output": structured,
                        "follow_up_facts": follow_up_facts,
                    }
                )
                return enriched

            while True:
                extra: dict[str, Any] = {}
                if final_requested:
                    extra["response_format"] = _response_format(
                        "product_enrichment", ProductEnrichment.response_schema()
                    )
                elif tools:
                    # The tool stays declared (the history has tool calls); past max_steps its calls are refused below.
                    extra.update(tools=tools, tool_choice="auto")
                response = await call(messages, **extra)
                choice = response.choices[0]
                message = choice.message
                # warnings=False: Gemini and Claude return content as a list of parts, which the SDK types as str
                messages.append(message.model_dump(exclude_none=True, warnings=False))
                if not message.tool_calls:
                    if getattr(choice, "finish_reason", None) == "length":
                        # A cut JSON cannot be repaired, only regenerated: ask once for a shorter answer (the pages
                        # are already paid for), then fail the product.
                        truncated = f"Model response was truncated at max_output_tokens={self.max_output_tokens}"
                        if truncated in repair_errors:
                            raise ValueError(truncated)
                        messages.pop()  # the cut answer is not sent back
                        json_repairs += 1
                        repair_errors.append(truncated)
                        print(f"[{seed.ean}] repair {json_repairs}: {truncated}")
                        messages.append({"role": "user", "content": REPAIR_TRUNCATED})
                        final_requested = structured
                        continue
                    text = _message_text(message.content)
                    if not text.strip():
                        # Seen after the last allowed tool round: ask for the answer instead of losing the product.
                        messages.pop()  # an empty assistant turn is not accepted back by every endpoint
                        json_repairs += 1
                        repair_errors.append("empty final response")
                        print(f"[{seed.ean}] repair {json_repairs}: empty final response")
                        if json_repairs > self.max_json_repairs:
                            raise ValueError("Model returned an empty final response")
                        messages.append({"role": "user", "content": REPAIR_EMPTY})
                        final_requested = structured
                        continue
                    try:
                        document, dropped = _keep_valid_items(_extract_json(text))
                        result = ProductEnrichment.model_validate(document)
                    except ValueError as exc:
                        json_repairs += 1
                        # recorded so the cause of each (costly, full-length) repair can be fixed at the source
                        repair_errors.append(f"{type(exc).__name__}: {str(exc)[:300]}")
                        print(f"[{seed.ean}] repair {json_repairs}: {repair_errors[-1]}")
                        if json_repairs > self.max_json_repairs:
                            raise ValueError(
                                f"Model did not produce valid catalog JSON after {self.max_json_repairs} repairs: {exc}"
                            ) from exc
                        messages.append(
                            {"role": "user", "content": repair_invalid(f"{type(exc).__name__}: {str(exc)[:500]}")}
                        )
                        final_requested = structured
                        continue
                    enriched = finish(result, dropped)
                    pending = _candidates_without_evidence(enriched)
                    if not pending:
                        return enriched
                    facts = await self._follow_up_facts(call, messages, pending, tools, seed.ean)
                    if not facts:
                        return enriched
                    result.facts.extend(facts)
                    return finish(result, dropped, follow_up_facts=len(facts))
                tool_steps += 1
                # tool_choice "none" made Claude answer empty; past the limit the calls are refused in the tool result
                if tool_steps > self.max_steps + 2:
                    raise RuntimeError(f"Agent exceeded the maximum of {self.max_steps} tool-use steps")
                over_limit = tool_steps > self.max_steps
                for tool_call in message.tool_calls:
                    name = tool_call.function.name
                    try:
                        call_arguments = json.loads(tool_call.function.arguments or "{}")
                    except json.JSONDecodeError as exc:
                        raise ValueError(f"Model produced invalid arguments for MCP tool {name}: {exc}") from exc
                    if over_limit:
                        content = over_limit_message(self.max_steps)
                    elif name not in allowed:
                        content = unknown_tool(name)
                    elif name == search_name:
                        model_searches += 1
                        properties = found_search["function"]["parameters"].get("properties", {})
                        query = str(call_arguments.get("query", ""))
                        content = _search_for_model(
                            await mcp.call(name, search_arguments(query, properties, rules.market))
                        )
                    elif canonicalize_url(str(call_arguments.get("url", ""))) in scraped_urls:
                        # already in the history: a second scrape would pay the credits and the tokens again
                        content = ALREADY_EXTRACTED
                    else:
                        tool_result = await self._call_tool(mcp, name, call_arguments)
                        if _tool_result_succeeded(tool_result):
                            canonical = canonicalize_url(str(call_arguments.get("url", "")))
                            if canonical:
                                scraped_urls.add(canonical)
                        content = _page_for_model(tool_result)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": external(content),
                        }
                    )

    async def _follow_up_facts(
        self,
        call: Any,
        messages: list[dict[str, Any]],
        pending: list[CatalogAttribute],
        tools: list[dict[str, Any]],
        ean: str,
    ) -> list[Fact]:
        """One extra turn, without Firecrawl, for the facts behind candidates the answer left without evidence.

        The pages are already in the (cached) history, so it costs one short answer; the facts it returns go through
        the same evidence policy (only scraped URLs) as the main answer. Best effort: any failure keeps the answer.
        The tools stay declared (and unused) so the call reads the prompt cache of the research.
        """
        request = evidence_follow_up(
            [{"code": item.code, "name": item.name, "candidate_value": item.candidate_value or ""} for item in pending]
        )
        history = [*messages, {"role": "user", "content": request}]
        extra: dict[str, Any] = {"max_tokens": FOLLOW_UP_MAX_TOKENS}
        if tools:
            extra.update(tools=tools, tool_choice="auto")
        try:
            response = await call(history, **extra)
            message = response.choices[0].message
            if message.tool_calls:
                return []
            document, dropped = _keep_valid_items({"facts": _extract_json(_message_text(message.content)).get("facts")})
            facts = [Fact.model_validate(item) for item in document.get("facts") or []]
        except Exception as exc:  # noqa: BLE001 - the main answer is already valid
            print(f"[{ean}] evidence follow-up skipped: {type(exc).__name__}: {str(exc)[:200]}")
            return []
        print(f"[{ean}] evidence follow-up: {len(facts)} facts for {len(pending)} candidates; dropped {dropped}")
        return facts
