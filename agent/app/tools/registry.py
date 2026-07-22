from __future__ import annotations

from datetime import datetime, timezone
import re

from app.core.config import Settings
from app.schemas.tools import RetrievalItem, RetrievalToolRequest, RetrievalToolResult, ToolCall
from app.tools.retrieval import timed_search, unavailable_result
from app.tools.web_search import WebSearchTool


RESERVED_SOURCES = {
    "browser_search",
    "builtin_trend_store",
    "official_rule_store",
}


class ToolRegistry:
    def __init__(self, settings: Settings) -> None:
        self.web_search = WebSearchTool(settings)
        self.xhs_fetcher = XhsFetcherTool(settings)

    def search(
        self, request: RetrievalToolRequest
    ) -> tuple[RetrievalToolResult, ToolCall]:
        if request.source == "web_search":
            return timed_search(self.web_search, request)
        if request.source == "xhs_fetcher":
            return timed_search(self.xhs_fetcher, request)
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
        queries = self._queries_for_request(request)
        if len(queries) <= 1:
            result, call = self.search(request)
            return self._score_result(result, request.query), [call]

        calls: list[ToolCall] = []
        successful_items: list[RetrievalItem] = []
        non_success_results: list[RetrievalToolResult] = []
        per_query_limit = max(1, request.limit)
        for query in queries[:3]:
            query_request = request.model_copy(
                update={"query": query, "limit": per_query_limit}
            )
            result, call = self.search(query_request)
            calls.append(call)
            if result.status == "success":
                successful_items.extend(self._score_result(result, query).items)
            else:
                non_success_results.append(result)

        if successful_items:
            return (
                RetrievalToolResult(
                    source=request.source,
                    status="success",
                    items=self._dedupe_items(successful_items)[: request.limit],
                ),
                calls,
            )
        if non_success_results:
            return non_success_results[0], calls
        return (
            RetrievalToolResult(source=request.source, status="empty", items=[]),
            calls,
        )

    def _queries_for_request(self, request: RetrievalToolRequest) -> list[str]:
        raw_queries = request.filters.get("queries") if request.filters else None
        candidates = raw_queries if isinstance(raw_queries, list) else [request.query]
        result: list[str] = []
        seen: set[str] = set()
        for item in candidates:
            query = " ".join(str(item or "").split())[:240]
            if not query or query in seen:
                continue
            result.append(query)
            seen.add(query)
            if len(result) >= 3:
                break
        return result or [request.query]

    def _dedupe_items(self, items: list[RetrievalItem]) -> list[RetrievalItem]:
        result: list[RetrievalItem] = []
        seen: set[str] = set()
        for item in sorted(
            items,
            key=lambda candidate: float(candidate.metadata.get("relevanceScore", 0)),
            reverse=True,
        ):
            key = item.url or item.title
            if not key or key in seen:
                continue
            result.append(item)
            seen.add(key)
        return result

    def _score_result(self, result: RetrievalToolResult, query: str) -> RetrievalToolResult:
        if result.status != "success":
            return result
        return result.model_copy(
            update={
                "items": [
                    item.model_copy(
                        update={"metadata": {**item.metadata, **self._score_item(item, query)}}
                    )
                    for item in result.items
                ]
            }
        )

    def _score_item(self, item: RetrievalItem, query: str) -> dict:
        text = f"{item.title} {item.summary}".lower()
        query_terms = [
            term
            for term in re.split(r"\s+", query.lower())
            if len(term.strip()) >= 2
        ]
        matched = sum(1 for term in query_terms if term in text)
        relevance = matched / max(len(query_terms), 1)
        provider = str(item.metadata.get("provider") or "").lower()
        source_trust = 0.7 if provider in {"tavily", "gemini_grounding"} else 0.5
        freshness = self._freshness_score(item.publishedAt or item.retrievedAt)
        xhs_like = self._xhs_like_signal(text)
        combined = round((relevance * 0.45) + (freshness * 0.2) + (source_trust * 0.2) + (xhs_like * 0.15), 3)
        return {
            "relevanceScore": combined,
            "freshnessScore": round(freshness, 3),
            "sourceTrust": round(source_trust, 3),
            "xhsLikeSignal": round(xhs_like, 3),
            "scoreNote": "Signals support content planning only, not official xiaohongshu heat.",
        }

    def _freshness_score(self, value: str | None) -> float:
        if not value:
            return 0.4
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return 0.4
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        age_days = max(0, (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).days)
        if age_days <= 7:
            return 1.0
        if age_days <= 30:
            return 0.75
        if age_days <= 90:
            return 0.5
        return 0.25

    def _xhs_like_signal(self, text: str) -> float:
        markers = ("小红书", "笔记", "图文", "封面", "标题", "种草", "避坑", "清单", "测评", "打卡")
        hits = sum(1 for marker in markers if marker in text)
        return min(1.0, hits / 4)


class XhsFetcherTool:
    name = "xhs_fetcher"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        if not getattr(self.settings, "enable_xhs_fetcher", False):
            return unavailable_result(
                request,
                message=(
                    "xhs_fetcher is reserved for authorized xiaohongshu data and is disabled by default. "
                    "It will not read cookies, log in, or bypass platform permissions."
                ),
                code="DISABLED",
            )
        return unavailable_result(
            request,
            message="xhs_fetcher provider is not configured.",
            code="TOOL_UNAVAILABLE",
        )


class _StaticRetrievalTool:
    name = "static_retrieval"

    def __init__(self, result: RetrievalToolResult) -> None:
        self.result = result

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        return self.result
