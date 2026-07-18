from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from google import genai

from app.core.config import Settings
from app.schemas.tools import RetrievalItem, RetrievalToolRequest, RetrievalToolResult
from app.tools.retrieval import unavailable_result


class WebSearchTool:
    name = "web_search"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        debug_auth = request.filters.get("debugAuth") if request.filters else None
        debug_api_key = ""
        debug_provider = ""
        debug_base_url = ""
        if self.settings.enable_debug_auth and isinstance(debug_auth, dict):
            debug_api_key = str(
                debug_auth.get("modelApiKey")
                or debug_auth.get("googleApiKey")
                or debug_auth.get("geminiApiKey")
                or debug_auth.get("webSearchApiKey")
                or ""
            ).strip()
            debug_provider = str(debug_auth.get("webSearchProvider") or "").strip()
            debug_base_url = str(
                debug_auth.get("modelBaseUrl")
                or debug_auth.get("googleBaseUrl")
                or debug_auth.get("geminiBaseUrl")
                or ""
            ).strip()

        if not self.settings.enable_web_search:
            return unavailable_result(
                request,
                message="Web search is disabled by ENABLE_WEB_SEARCH.",
            )
        provider = (
            debug_provider
            or self.settings.web_search_provider
            or ("tavily" if debug_api_key else "")
        ).strip().lower()
        if not provider:
            return unavailable_result(
                request,
                message="WEB_SEARCH_PROVIDER is not configured.",
            )
        api_key = (
            debug_api_key
            or self.settings.web_search_api_key
            or self.settings.model_api_key
        )
        if not api_key:
            return unavailable_result(
                request,
                message="Web search API key is not configured.",
            )

        if provider in {"gemini", "gemini_grounding", "google"}:
            return self._search_gemini_grounding(request, api_key, debug_base_url)
        if provider == "tavily":
            return self._search_tavily(request, api_key)

        return unavailable_result(
            request,
            message=f"Unsupported web search provider: {provider}",
            code="UNSUPPORTED_PROVIDER",
        )

    def _search_tavily(
        self,
        request: RetrievalToolRequest,
        api_key: str,
    ) -> RetrievalToolResult:
        timeout_ms = request.timeoutMs or self.settings.web_search_timeout_ms
        timeout = max(timeout_ms / 1000, 1)
        payload: dict[str, Any] = {
            "query": request.query,
            "max_results": request.limit,
            "include_answer": False,
            "include_raw_content": False,
        }
        headers = {"Authorization": f"Bearer {api_key}"}

        try:
            response = httpx.post(
                "https://api.tavily.com/search",
                json=payload,
                headers=headers,
                timeout=timeout,
            )
            response.raise_for_status()
        except httpx.TimeoutException:
            return unavailable_result(request, message="Web search request timed out.")
        except httpx.HTTPStatusError as exc:
            return unavailable_result(
                request,
                message=f"Web search provider returned HTTP {exc.response.status_code}.",
            )
        except httpx.HTTPError as exc:
            return unavailable_result(request, message=f"Web search request failed: {exc}")

        data = response.json()
        items = [
            RetrievalItem(
                title=item.get("title") or "Untitled",
                url=item.get("url"),
                summary=item.get("content") or item.get("snippet") or "",
                platform=request.platform,
                contentType=request.filters.get("contentType"),
                retrievedAt=datetime.now(timezone.utc).isoformat(),
                metadata={"provider": "tavily", "score": item.get("score")},
            )
            for item in data.get("results", [])[: request.limit]
        ]
        return RetrievalToolResult(
            source="web_search",
            status="success" if items else "empty",
            items=items,
        )

    def _search_gemini_grounding(
        self,
        request: RetrievalToolRequest,
        api_key: str,
        base_url_override: str = "",
    ) -> RetrievalToolResult:
        base_url = self._normalize_gemini_base_url(
            base_url_override or self.settings.model_base_url
        )
        try:
            client = genai.Client(
                api_key=api_key,
                http_options=genai.types.HttpOptions(base_url=base_url),
            )
            response = client.models.generate_content(
                model=self.settings.model_name,
                contents=(
                    "请联网搜索并总结以下问题。"
                    "输出需要覆盖近期趋势、可参考来源和与小红书内容创作相关的要点。"
                    f"\n问题：{request.query}"
                ),
                config=genai.types.GenerateContentConfig(
                    tools=[genai.types.Tool(google_search=genai.types.GoogleSearch())],
                    temperature=0.2,
                ),
            )
        except Exception as exc:
            return unavailable_result(
                request,
                message=f"Gemini grounding search request failed: {exc}",
            )

        output_text = getattr(response, "text", "") or ""
        sources = self._extract_gemini_grounding_sources(response)
        retrieved_at = datetime.now(timezone.utc).isoformat()
        items = [
            RetrievalItem(
                title=source.get("title") or f"Gemini Grounding Source {index + 1}",
                url=source.get("url"),
                summary=output_text[:1200] if index == 0 else "",
                platform=request.platform,
                contentType=request.filters.get("contentType"),
                retrievedAt=retrieved_at,
                metadata={
                    "provider": "gemini_grounding",
                    "model": self.settings.model_name,
                },
            )
            for index, source in enumerate(sources[: request.limit])
        ]
        if not items and output_text:
            items = [
                RetrievalItem(
                    title="Gemini Grounding Summary",
                    url=None,
                    summary=output_text[:1200],
                    platform=request.platform,
                    contentType=request.filters.get("contentType"),
                    retrievedAt=retrieved_at,
                    metadata={
                        "provider": "gemini_grounding",
                        "model": self.settings.model_name,
                    },
                )
            ]
        return RetrievalToolResult(
            source="web_search",
            status="success" if items else "empty",
            items=items,
        )

    def _extract_gemini_grounding_sources(self, response: Any) -> list[dict[str, str]]:
        metadata = getattr(response, "candidates", None)
        if not metadata:
            return []
        candidate = metadata[0]
        grounding_metadata = getattr(candidate, "grounding_metadata", None)
        if not grounding_metadata:
            return []
        chunks = getattr(grounding_metadata, "grounding_chunks", None) or []
        sources: list[dict[str, str]] = []
        seen = set()
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if not web:
                continue
            url = getattr(web, "uri", None)
            if not isinstance(url, str) or url in seen:
                continue
            seen.add(url)
            title = getattr(web, "title", None)
            sources.append({"title": title or url, "url": url})
        return sources

    def _normalize_gemini_base_url(self, base_url: str) -> str:
        cleaned = base_url.strip().rstrip("/")
        if cleaned.endswith("/v1beta"):
            cleaned = cleaned[: -len("/v1beta")]
        if cleaned.endswith("/v1"):
            cleaned = cleaned[: -len("/v1")]
        return cleaned
