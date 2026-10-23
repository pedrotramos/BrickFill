from __future__ import annotations

import asyncio
import json
from contextlib import AsyncExitStack, nullcontext
from types import TracebackType
from typing import Any

import httpx
from databricks.sdk import WorkspaceClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client  # MCP >= 1.30 (accepts http_client)
from mcp.shared._httpx_utils import create_mcp_http_client
from typing_extensions import Self


class FirecrawlMCPClient:
    """Firecrawl MCP session authenticated with a Bearer header, so the key never appears in a URL or log.

    A legacy template with ``{api_key}`` in the path is still accepted, but the default endpoint
    (https://mcp.firecrawl.dev/v2/mcp) keeps the key out of the URL.
    """

    def __init__(self, endpoint_template: str, api_key: str, slots: asyncio.Semaphore | None = None) -> None:
        self.endpoint = endpoint_template.replace("{api_key}", api_key)
        # Shared with the capture collector: every Firecrawl request of the run counts toward the plan's limit.
        self.slots = slots
        self._headers = {} if "{api_key}" in endpoint_template else {"Authorization": f"Bearer {api_key}"}
        self._exit_stack: AsyncExitStack | None = None
        self.session: ClientSession | None = None

    async def __aenter__(self) -> Self:
        stack = AsyncExitStack()
        self._exit_stack = stack
        try:
            # Same timeouts and redirect policy the MCP SDK uses by default, plus the auth header.
            http_client = await stack.enter_async_context(create_mcp_http_client(headers=self._headers))
            streams = await stack.enter_async_context(streamable_http_client(self.endpoint, http_client=http_client))
            read_stream, write_stream = streams[0], streams[1]
            self.session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
            await self.session.initialize()
            return self
        except BaseException:
            await stack.aclose()
            self._exit_stack = None
            self.session = None
            raise

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.__aexit__(exc_type, exc, tb)
            self._exit_stack = None
            self.session = None

    async def openai_tools(self) -> list[dict[str, Any]]:
        if self.session is None:
            raise RuntimeError("MCP session is not initialized")
        response = await self.session.list_tools()
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "Firecrawl MCP tool",
                    "parameters": tool.inputSchema,
                },
            }
            for tool in response.tools
        ]

    async def tools(self) -> list[Any]:
        if self.session is None:
            raise RuntimeError("MCP session is not initialized")
        return list((await self.session.list_tools()).tools)

    async def call(self, name: str, arguments: dict[str, Any]) -> str:
        if self.session is None:
            raise RuntimeError("MCP session is not initialized")
        async with self.slots or nullcontext():
            response = await self.session.call_tool(name, arguments)
        payload: list[dict[str, Any]] = []
        for item in response.content:
            if hasattr(item, "model_dump"):
                payload.append(item.model_dump(mode="json"))
            else:
                payload.append({"type": "text", "text": str(item)})
        return json.dumps({"is_error": bool(response.isError), "content": payload}, ensure_ascii=False)


class DatabricksMCPClient:
    """Async MCP client authenticated with the current Databricks identity."""

    def __init__(
        self,
        service_name: str,
        workspace_client: WorkspaceClient | None = None,
        request_timeout_seconds: float = 180.0,
    ) -> None:
        self.workspace = workspace_client or WorkspaceClient()
        host = self.workspace.config.host.rstrip("/")
        self.endpoint = f"{host}/ai-gateway/mcp-services/{service_name}"
        self.request_timeout_seconds = request_timeout_seconds
        self._exit_stack: AsyncExitStack | None = None
        self.session: ClientSession | None = None

    async def __aenter__(self) -> Self:
        stack = AsyncExitStack()
        self._exit_stack = stack
        try:
            http_client = await stack.enter_async_context(
                httpx.AsyncClient(
                    headers=self.workspace.config.authenticate(),
                    timeout=httpx.Timeout(self.request_timeout_seconds),
                )
            )
            streams = await stack.enter_async_context(streamable_http_client(self.endpoint, http_client=http_client))
            read_stream, write_stream = streams[0], streams[1]
            self.session = await stack.enter_async_context(ClientSession(read_stream, write_stream))
            await self.session.initialize()
            return self
        except BaseException:
            await stack.aclose()
            self._exit_stack = None
            self.session = None
            raise

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self._exit_stack is not None:
            await self._exit_stack.__aexit__(exc_type, exc, tb)
            self._exit_stack = None
            self.session = None

    async def tools(self) -> list[Any]:
        if self.session is None:
            raise RuntimeError("MCP session is not initialized")
        return list((await self.session.list_tools()).tools)

    async def call(self, name: str, arguments: dict[str, Any]) -> str:
        if self.session is None:
            raise RuntimeError("MCP session is not initialized")
        response = await self.session.call_tool(name, arguments)
        payload: list[dict[str, Any]] = []
        for item in response.content:
            if hasattr(item, "model_dump"):
                payload.append(item.model_dump(mode="json"))
            else:
                payload.append({"type": "text", "text": str(item)})
        return json.dumps(
            {
                "is_error": bool(response.isError),
                "content": payload,
                "structured_content": response.structuredContent,
            },
            ensure_ascii=False,
        )
