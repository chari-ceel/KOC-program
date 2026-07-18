from __future__ import annotations

from app.core.config import Settings
from app.schemas.tools import RetrievalToolRequest, RetrievalToolResult, ToolCall
from app.tools.retrieval import timed_search, unavailable_result
from app.tools.web_search import WebSearchTool


RESERVED_SOURCES = {
    "browser_search",
    "xhs_fetcher",
    "builtin_trend_store",
    "official_rule_store",
}


class ToolRegistry:
    def __init__(self, settings: Settings) -> None:
        self.web_search = WebSearchTool(settings)

    def search(
        self, request: RetrievalToolRequest
    ) -> tuple[RetrievalToolResult, ToolCall]:
        if request.source == "web_search":
            return timed_search(self.web_search, request)
        if request.source in RESERVED_SOURCES:
            result = unavailable_result(
                request,
                message=f"Retrieval source is reserved and not implemented: {request.source}",
                code="RESERVED_TOOL",
            )
            return timed_search(_StaticRetrievalTool(result), request)

        result = unavailable_result(
            request,
            message=f"Unknown retrieval source: {request.source}",
            code="UNKNOWN_TOOL",
        )
        return timed_search(_StaticRetrievalTool(result), request)

    def search_with_fallback(
        self, request: RetrievalToolRequest
    ) -> tuple[RetrievalToolResult, list[ToolCall]]:
        result, call = self.search(request)
        return result, [call]


class _StaticRetrievalTool:
    name = "static_retrieval"

    def __init__(self, result: RetrievalToolResult) -> None:
        self.result = result

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        return self.result
