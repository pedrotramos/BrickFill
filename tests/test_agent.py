"""The agent loop against a scripted model and a fake Firecrawl MCP: no network, no credits."""

from __future__ import annotations

import asyncio
import copy
import json
from types import SimpleNamespace
from typing import Any

import pytest
from conftest import EAN, OFFICIAL_URL, definition, make_result
from typing_extensions import Self

from brickfill import agent as agent_module
from brickfill.agent import CatalogResearchAgent
from brickfill.prompt import ALREADY_EXTRACTED
from brickfill.research import FIRECRAWL_SEARCH, DiscoveryReport

PAGE = json.dumps({"content": [{"text": json.dumps({"markdown": "Acme X100. Material: Steel. Power: 750 W"})}]})
TOOLS = [
    {"type": "function", "function": {"name": "firecrawl_scrape", "parameters": {"properties": {"url": {}}}}},
    {"type": "function", "function": {"name": "firecrawl_search", "parameters": {"properties": {"query": {}}}}},
]


class FakeMCP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def openai_tools(self) -> list[dict[str, Any]]:
        return TOOLS

    async def call(self, name: str, arguments: dict[str, Any]) -> str:
        self.calls.append((name, arguments))
        return PAGE


class Message:
    def __init__(self, content: str | None = None, tool_calls: list[dict[str, Any]] | None = None) -> None:
        self.content = content
        self._calls = tool_calls or []
        self.tool_calls = [
            SimpleNamespace(id=call["id"], function=SimpleNamespace(**call["function"])) for call in self._calls
        ] or None

    def model_dump(self, **_kwargs: Any) -> dict[str, Any]:
        message: dict[str, Any] = {"role": "assistant", "content": self.content}
        if self._calls:
            message["tool_calls"] = self._calls
        return message


def scrape_call(url: str, call_id: str = "call_1") -> Message:
    arguments = json.dumps({"url": url})
    return Message(
        tool_calls=[
            {"id": call_id, "type": "function", "function": {"name": "firecrawl_scrape", "arguments": arguments}}
        ]
    )


class ScriptedModel:
    """``openai`` client stand-in: answers the scripted messages in order and records every request."""

    def __init__(self, answers: list[Message]) -> None:
        self.answers = list(answers)
        self.requests: list[dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **arguments: Any) -> Any:
        self.requests.append(copy.deepcopy(arguments))
        usage = SimpleNamespace(
            prompt_tokens=1000, completion_tokens=100, cache_read_input_tokens=600, cache_creation_input_tokens=50
        )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=self.answers.pop(0), finish_reason="stop")], usage=usage
        )


def answer(**overrides: Any) -> Message:
    document = make_result(**overrides).model_dump(mode="json", exclude={"research_trace"})
    return Message(json.dumps(document))


@pytest.fixture
def run(monkeypatch, seed):
    mcp = FakeMCP()

    async def discover(*_args: Any, **_kwargs: Any) -> DiscoveryReport:
        return DiscoveryReport(
            queries=[EAN], responses=["results"], candidate_urls=[OFFICIAL_URL], provider=FIRECRAWL_SEARCH
        )

    monkeypatch.setattr(agent_module, "FirecrawlMCPClient", lambda *_args: mcp)
    monkeypatch.setattr(agent_module, "discover_sources_firecrawl", discover)

    def run(answers: list[Message], definitions=(), structured: bool = False):
        agent = CatalogResearchAgent.__new__(CatalogResearchAgent)
        agent.__dict__.update(
            model_endpoint="databricks-claude-sonnet-4-6",
            mcp_url="https://mcp.example.com",
            api_key="key",
            max_steps=3,
            max_json_repairs=2,
            max_output_tokens=32000,
            max_prefetch_urls=5,
            capture_collector=None,
            use_native_web_search=False,
            send_temperature=True,
            structured_output=structured,
            openai=ScriptedModel(answers),
        )
        result = asyncio.run(agent.enrich(seed, list(definitions)))
        return result, agent.openai.requests, mcp.calls

    return run


def test_scrape_deduplication_and_cached_final_answer(run):
    result, requests, mcp_calls = run([scrape_call(OFFICIAL_URL), answer()], structured=True)

    # the prefetch scraped the page once; the model's second scrape of it is answered from the history
    assert [name for name, _ in mcp_calls] == ["firecrawl_scrape"]
    tool_result = requests[1]["messages"][-1]
    assert tool_result["role"] == "tool" and ALREADY_EXTRACTED in tool_result["content"][0]["text"]

    # the final answer keeps the tools declared, so it reads the prompt cache of the research
    assert all("tools" in request and "response_format" not in request for request in requests)
    trace = result.research_trace
    assert (trace.model_calls, trace.json_repairs, trace.structured_output) == (2, 0, True)
    assert (trace.input_tokens, trace.cached_input_tokens, trace.cache_write_input_tokens) == (2000, 1200, 100)


def test_repair_is_constrained_to_the_schema(run):
    result, requests, _ = run([Message('{"ean": "truncated'), answer()], structured=True)
    repair = requests[1]
    assert "tools" not in repair and repair["response_format"]["json_schema"]["strict"] is True
    assert result.research_trace.json_repairs == 1

    _result, requests, _ = run([Message('{"ean": "truncated'), answer()], structured=False)
    assert "tools" in requests[1] and "response_format" not in requests[1]


def test_moving_cache_breakpoint_does_not_pile_up(run):
    _result, requests, _ = run([scrape_call("https://shop.example.net/p/x100"), answer()])
    first, second = requests
    assert len(first["messages"]) == 2  # system + user (which carries its own breakpoint)
    marked = [message for message in second["messages"] if isinstance(message.get("content"), list)]
    assert [message["role"] for message in marked] == ["user", "tool"]
    assert all(part.get("cache_control") for message in marked for part in message["content"])


def test_evidence_follow_up_links_candidates_without_facts(run):
    material = definition("5", "Material", required=True)
    follow_up = Message(
        json.dumps(
            {
                "facts": [
                    {
                        "name": "Material",
                        "value": "Steel",
                        "confidence": 0.9,
                        "evidence": [{"url": OFFICIAL_URL, "source_tier": "official", "excerpt": "Material: Steel"}],
                    }
                ]
            }
        )
    )
    first = answer(attributes=[{"code": "5", "candidate_value": "Steel"}])
    result, requests, mcp_calls = run([first, follow_up], definitions=[material])

    attribute = next(item for item in result.attributes if item.code == "5")
    assert attribute.value == "Steel"
    assert [str(url) for url in attribute.evidence_urls] == [OFFICIAL_URL]
    assert result.research_trace.follow_up_facts == 1
    assert len(mcp_calls) == 1  # no Firecrawl call for the follow-up
    assert "Material (code 5)" in requests[1]["messages"][-1]["content"][0]["text"]


def test_follow_up_failure_keeps_the_answer(run):
    first = answer(attributes=[{"code": "5", "candidate_value": "Steel"}])
    result, _requests, _ = run([first, Message("no JSON here")], definitions=[definition("5", "Material")])
    assert next(item for item in result.attributes if item.code == "5").rejection_code == "NO_EVIDENCE_FOR_CANDIDATE"
    assert result.research_trace.follow_up_facts == 0


def test_tool_calls_past_the_limit_are_refused(run):
    urls = [f"https://shop.example.net/p/{index}" for index in range(4)]
    answers = [scrape_call(url, f"call_{index}") for index, url in enumerate(urls)] + [answer()]
    result, requests, mcp_calls = run(answers)
    assert len(mcp_calls) == 1 + 3  # prefetch + max_steps scrapes; the fourth is refused
    assert "Limit of 3 extraction rounds" in requests[-1]["messages"][-1]["content"][0]["text"]
    assert result.research_trace.tool_steps == 4
