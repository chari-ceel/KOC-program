from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

import httpx

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

    def search_trend_evidence(
        self, request: RetrievalToolRequest
    ) -> tuple[RetrievalToolResult, list[ToolCall]]:
        """Try authorized XHS evidence first, then public web evidence."""
        source_order = ["xhs_fetcher", "web_search"] if request.platform == "xiaohongshu" else [request.source]
        calls: list[ToolCall] = []
        failed_results: list[RetrievalToolResult] = []
        for source in source_order:
            source_request = request.model_copy(update={"source": source})
            result, source_calls = self.search_with_fallback(source_request)
            calls.extend(source_calls)
            if result.status == "success":
                return result, calls
            failed_results.append(result)
        if failed_results:
            return failed_results[-1], calls
        return RetrievalToolResult(source=request.source, status="empty", items=[]), calls

    def doctor(self) -> dict:
        web_status = "disabled"
        web_reason = "Web search is disabled by ENABLE_WEB_SEARCH."
        if self.web_search.settings.enable_web_search:
            if not self.web_search.settings.web_search_provider:
                web_status = "needs_config"
                web_reason = "WEB_SEARCH_PROVIDER is not configured."
            elif not (self.web_search.settings.web_search_api_key or self.web_search.settings.model_api_key):
                web_status = "needs_auth"
                web_reason = "Web search API key is not configured."
            else:
                web_status = "available"
                web_reason = "Configured."

        xhs_status, xhs_reason = self.xhs_fetcher.doctor()
        overall = "configured" if xhs_status == "available" or web_status == "available" else "partial"
        return {
            "toolType": "retrieval",
            "status": overall,
            "sources": [
                {"source": "xhs_fetcher", "status": xhs_status, "role": "primary", "reason": xhs_reason},
                {"source": "web_search", "status": web_status, "role": "fallback", "reason": web_reason},
                {"source": "browser_search", "status": "reserved", "role": "reserved"},
                {"source": "builtin_trend_store", "status": "reserved", "role": "reserved"},
                {"source": "official_rule_store", "status": "reserved", "role": "reserved"},
            ],
        }

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

    def doctor(self) -> tuple[str, str]:
        if not getattr(self.settings, "enable_xhs_fetcher", False):
            return "disabled", "xhs_fetcher is disabled by ENABLE_XHS_FETCHER."
        provider = self._provider()
        if not provider:
            return "needs_config", "XHS_FETCHER_PROVIDER is not configured."
        if provider != "xiaohongshu_mcp":
            return "failed", f"Unsupported xhs_fetcher provider: {provider}."
        if not self._base_url():
            return "needs_config", "XHS_MCP_BASE_URL is not configured."
        if not self._api_key():
            return "needs_auth", "XHS_MCP_API_KEY is not configured."
        return "available", "xiaohongshu_mcp is configured."

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
        provider = self._provider()
        if not provider:
            return unavailable_result(request, message="XHS_FETCHER_PROVIDER is not configured.", code="NEEDS_CONFIG")
        if provider != "xiaohongshu_mcp":
            return unavailable_result(request, message=f"Unsupported xhs_fetcher provider: {provider}", code="UNSUPPORTED_PROVIDER")
        if not self._base_url():
            return unavailable_result(request, message="XHS_MCP_BASE_URL is not configured.", code="NEEDS_CONFIG")
        if not self._api_key():
            return unavailable_result(request, message="XHS_MCP_API_KEY is not configured.", code="NEEDS_AUTH")
        return self._search_xiaohongshu_mcp(request)

    def _search_xiaohongshu_mcp(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        url = f"{self._base_url().rstrip('/')}/search"
        payload = {
            "query": request.query,
            "platform": request.platform,
            "limit": request.limit,
            "filters": self._safe_filters(request.filters),
        }
        try:
            response = httpx.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {self._api_key()}"},
                timeout=max((request.timeoutMs or self.settings.web_search_timeout_ms) / 1000, 1),
                trust_env=False,
            )
            response.raise_for_status()
            data = response.json()
        except httpx.TimeoutException:
            return unavailable_result(request, message="xiaohongshu_mcp request timed out.")
        except httpx.HTTPStatusError as exc:
            code = "NEEDS_AUTH" if exc.response.status_code in {401, 403} else "TOOL_UNAVAILABLE"
            return unavailable_result(request, message=f"xiaohongshu_mcp returned HTTP {exc.response.status_code}.", code=code)
        except (httpx.HTTPError, ValueError) as exc:
            return unavailable_result(request, message=f"xiaohongshu_mcp request failed: {exc}")

        raw_items = self._extract_items(data)
        items = [self._normalize_item(item, request) for item in raw_items[: request.limit]]
        items = [item for item in items if item is not None]
        return RetrievalToolResult(
            source="xhs_fetcher",
            status="success" if items else "empty",
            items=items,
        )

    def _extract_items(self, data: Any) -> list[dict[str, Any]]:
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if not isinstance(data, dict):
            return []
        for key in ("items", "results", "notes", "data"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = self._extract_items(value)
                if nested:
                    return nested
        return []

    def _normalize_item(self, item: dict[str, Any], request: RetrievalToolRequest) -> RetrievalItem | None:
        title = str(item.get("title") or item.get("name") or item.get("noteTitle") or "").strip()
        summary = str(item.get("summary") or item.get("desc") or item.get("content") or item.get("text") or "").strip()
        if not title and not summary:
            return None
        metrics = item.get("metrics") if isinstance(item.get("metrics"), dict) else {}
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        return RetrievalItem(
            title=title or "小红书笔记",
            url=item.get("url") or item.get("link") or item.get("shareUrl"),
            summary=summary,
            platform="xiaohongshu",
            contentType=request.filters.get("contentType") or item.get("contentType"),
            publishedAt=item.get("publishedAt") or item.get("publishTime"),
            metrics={
                "likes": metrics.get("likes") or item.get("likes"),
                "saves": metrics.get("saves") or item.get("saves") or item.get("collects"),
                "comments": metrics.get("comments") or item.get("comments"),
                "shares": metrics.get("shares") or item.get("shares"),
            },
            metadata={
                **metadata,
                "provider": "xiaohongshu_mcp",
                "evidenceTier": "direct_xhs",
                "sourceTrust": 0.95,
            },
        )

    def _safe_filters(self, filters: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in (filters or {}).items() if key != "debugAuth"}

    def _provider(self) -> str:
        return str(getattr(self.settings, "xhs_fetcher_provider", "") or "").strip().lower()

    def _base_url(self) -> str:
        return str(getattr(self.settings, "xhs_mcp_base_url", "") or "").strip()

    def _api_key(self) -> str:
        return str(getattr(self.settings, "xhs_mcp_api_key", "") or "").strip()


class _StaticRetrievalTool:
    name = "static_retrieval"

    def __init__(self, result: RetrievalToolResult) -> None:
        self.result = result

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        return self.result
