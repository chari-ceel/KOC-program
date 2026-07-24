from typing import Any

from app.runtime.base import ModelRuntime
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.schemas.tools import RetrievalItem, RetrievalToolRequest, RetrievalToolResult, ToolCall
from app.tools.retrieval import build_tool_call
from app.workflows.base import ToolRegistry
from app.workflows.trend_tracking import TrendTrackingWorkflow


class CapturingRuntime(ModelRuntime):
    def __init__(self) -> None:
        self.generated_request: AgentRunRequest | None = None
        self.generated_prompt: str | None = None

    def decide_retrieval(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> RetrievalToolRequest | None:
        return RetrievalToolRequest(
            source="web_search",
            query="小红书 大学生成长 热门选题",
            limit=2,
            filters={},
        )

    def generate(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> AgentRunResponse:
        self.generated_request = request
        self.generated_prompt = prompt
        return AgentRunResponse(
            requestId=request.request_id,
            taskType=request.task_type,
            platform=request.platform,
            status="success",
            data={"reply": "ok"},
            savePayload={},
            metadata={},
        )


def test_workflow_runs_retrieval_before_final_generation(monkeypatch) -> None:
    def fake_search_with_fallback(self, request: RetrievalToolRequest) -> tuple[RetrievalToolResult, list[ToolCall]]:
        result = RetrievalToolResult(
            source="web_search",
            status="success",
            items=[
                RetrievalItem(
                    title="大学生成长热门选题观察",
                    url="https://example.com/trend",
                    summary="真实检索结果摘要",
                    platform="xiaohongshu",
                )
            ],
        )
        call = build_tool_call(request=request, result=result, duration_ms=12)
        return result, [call]

    monkeypatch.setattr(ToolRegistry, "search_with_fallback", fake_search_with_fallback)

    runtime = CapturingRuntime()
    workflow = TrendTrackingWorkflow()
    workflow.runtime = runtime

    response = workflow.track(
        AgentRunRequest(
            requestId="req_retrieval_first",
            taskType="trend.track",
            platform="xiaohongshu",
            userId="demo-user",
            input={"userPreference": "更容易涨粉的选题"},
            context={
                "savedPersona": {
                    "persona": {"name": "大学生成长型学习博主"},
                    "niche": {"primary": "大学生成长"},
                }
            },
            options={"enableTools": True, "maxToolCalls": 2},
        )
    )

    assert response.status == "success"
    assert response.metadata["retrievalSource"] == "web_search"
    assert response.metadata["webSearchDecision"] == "used"
    assert runtime.generated_request is not None
    assert runtime.generated_request.context["retrievalResults"]
    assert runtime.generated_request.context["toolResults"][0]["source"] == "web_search"
    assert runtime.generated_prompt is not None
    assert "Web Search Results" in runtime.generated_prompt
    assert response.tool_calls
    assert response.sources[0]["sourceType"] == "web_search"
    assert response.metadata["evidenceSummary"]["label"] == "公开网页佐证"


def test_trend_workflow_continues_when_forced_retrieval_fails(monkeypatch) -> None:
    def fake_search_with_fallback(self, request: RetrievalToolRequest) -> tuple[RetrievalToolResult, list[ToolCall]]:
        result = RetrievalToolResult(source=request.source, status="failed", items=[])
        call = build_tool_call(request=request, result=result, duration_ms=8)
        return result, [call]

    monkeypatch.setattr(ToolRegistry, "search_with_fallback", fake_search_with_fallback)

    runtime = CapturingRuntime()
    workflow = TrendTrackingWorkflow()
    workflow.runtime = runtime

    response = workflow.track(
        AgentRunRequest(
            requestId="req_retrieval_failed_open",
            taskType="trend.track",
            platform="xiaohongshu",
            userId="demo-user",
            input={"userPreference": "更容易涨粉的选题"},
            context={
                "savedPersona": {
                    "persona": {"name": "大学生成长型学习博主"},
                    "niche": {"primary": "大学生成长"},
                }
            },
            options={"enableTools": True, "maxToolCalls": 2},
        )
    )

    assert response.status == "success"
    assert response.metadata["webSearchDecision"] == "failed_open"
    assert response.metadata["evidenceSummary"]["tier"] == "inferred"
    assert runtime.generated_request is not None
    assert runtime.generated_request.context["toolResults"][0]["status"] == "failed"
    assert runtime.generated_request.context["evidenceSummary"]["label"] == "需要验证"
