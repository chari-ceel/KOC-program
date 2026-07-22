from app.core.config import Settings
from app.schemas.tools import RetrievalItem, RetrievalToolRequest, RetrievalToolResult
from app.tools.registry import ToolRegistry
from app.tools.web_search import WebSearchTool


def test_web_search_missing_provider_returns_failed_result() -> None:
    tool = WebSearchTool(
        Settings(
            ENABLE_WEB_SEARCH=True,
            WEB_SEARCH_PROVIDER="",
            WEB_SEARCH_API_KEY="",
        )
    )
    result = tool.search(
        RetrievalToolRequest(
            source="web_search",
            query="小红书 大学生成长 热门选题",
        )
    )

    assert result.status == "failed"
    assert result.error is not None
    assert result.error.code == "TOOL_UNAVAILABLE"


def test_registry_returns_failed_result_when_web_search_unconfigured() -> None:
    registry = ToolRegistry(
        Settings(
            ENABLE_WEB_SEARCH=True,
            WEB_SEARCH_PROVIDER="",
            WEB_SEARCH_API_KEY="",
        )
    )

    result, calls = registry.search_with_fallback(
        RetrievalToolRequest(
            source="web_search",
            query="小红书 大学生成长 热门选题",
            limit=2,
        )
    )

    assert result.status == "failed"
    assert result.source == "web_search"
    assert len(calls) == 1
    assert calls[0].status == "failed"
    assert calls[0].error is not None
    assert calls[0].error.code == "TOOL_UNAVAILABLE"


def test_debug_auth_key_is_not_written_to_tool_call() -> None:
    registry = ToolRegistry(
        Settings(
            ENABLE_WEB_SEARCH=True,
            WEB_SEARCH_PROVIDER="",
            WEB_SEARCH_API_KEY="",
            ENABLE_DEBUG_AUTH=True,
        )
    )

    result, calls = registry.search_with_fallback(
        RetrievalToolRequest(
            source="web_search",
            query="小红书 大学生成长 热门选题",
            filters={
                "debugAuth": {
                    "webSearchProvider": "unsupported_for_fast_test",
                    "webSearchApiKey": "secret-test-key",
                }
            },
        )
    )

    serialized = str([call.model_dump(mode="json") for call in calls])
    assert result.source == "web_search"
    assert "secret-test-key" not in serialized


def test_registry_returns_disabled_result_for_xhs_fetcher_by_default() -> None:
    registry = ToolRegistry(Settings())

    result, call = registry.search(
        RetrievalToolRequest(
            source="xhs_fetcher",
            query="小红书 大学生成长 热门选题",
        )
    )

    assert result.status == "failed"
    assert result.error is not None
    assert result.error.code == "DISABLED"
    assert call.status == "failed"


def test_registry_aggregates_and_scores_multiple_queries() -> None:
    class FakeSearchTool:
        name = "web_search"

        def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
            return RetrievalToolResult(
                source="web_search",
                status="success",
                items=[
                    RetrievalItem(
                        title=f"{request.query} 小红书笔记",
                        url=f"https://example.com/{request.query}",
                        summary="适合小红书图文选题、封面和标题参考。",
                        metadata={"provider": "tavily"},
                    )
                ],
            )

    registry = ToolRegistry(Settings())
    registry.web_search = FakeSearchTool()

    result, calls = registry.search_with_fallback(
        RetrievalToolRequest(
            source="web_search",
            query="小红书 修仙文",
            limit=3,
            filters={"queries": ["小红书 修仙文", "修仙文 爆款标题"]},
        )
    )

    assert result.status == "success"
    assert len(calls) == 2
    assert len(result.items) == 2
    assert "relevanceScore" in result.items[0].metadata
    assert "xhsLikeSignal" in result.items[0].metadata


def test_web_search_accepts_gemini_provider_without_rejecting(monkeypatch) -> None:
    def fake_search(*args, **kwargs):
        raise RuntimeError("network skipped")

    monkeypatch.setattr(WebSearchTool, "_search_gemini_grounding", fake_search)
    tool = WebSearchTool(
        Settings(
            ENABLE_WEB_SEARCH=True,
            WEB_SEARCH_PROVIDER="gemini",
            MODEL_API_KEY="test-key",
        )
    )

    try:
        tool.search(RetrievalToolRequest(source="web_search", query="小红书 热门趋势"))
    except RuntimeError as exc:
        assert str(exc) == "network skipped"
