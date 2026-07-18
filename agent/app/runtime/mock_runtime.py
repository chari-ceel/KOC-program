from typing import Any

from app.responses.mock_response_loader import MockResponseLoader
from app.runtime.base import ModelRuntime
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.schemas.tools import RetrievalToolRequest


class MockRuntime(ModelRuntime):
    """Runtime that returns deterministic mock responses for integration tests."""

    def __init__(self, loader: MockResponseLoader | None = None) -> None:
        self.loader = loader or MockResponseLoader()

    def generate(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> AgentRunResponse:
        if request.task_type == "memory.summarize_conversation":
            input_data = request.input or {}
            previous_summary = input_data.get("previousSummary") if isinstance(input_data.get("previousSummary"), dict) else {}
            messages = input_data.get("messagesToSummarize") if isinstance(input_data.get("messagesToSummarize"), list) else []
            user_messages = [
                str(item.get("content")).strip()
                for item in messages
                if isinstance(item, dict) and item.get("role") == "user" and isinstance(item.get("content"), str)
            ]
            assistant_messages = [
                str(item.get("content")).strip()
                for item in messages
                if isinstance(item, dict) and item.get("role") == "assistant" and isinstance(item.get("content"), str)
            ]
            covered_count = int(input_data.get("targetCoveredMessageCount") or len(messages))
            return AgentRunResponse(
                request_id=request.request_id,
                task_type=request.task_type,
                platform=request.platform,
                status="success",
                data={
                    "conversationSummary": {
                        "version": "v1",
                        "scene": input_data.get("scene") or "unknown",
                        "coveredMessageCount": covered_count,
                        "userGoal": user_messages[-1] if user_messages else previous_summary.get("userGoal", ""),
                        "confirmedFacts": (previous_summary.get("confirmedFacts") or [])[:6],
                        "assistantFindings": assistant_messages[-3:],
                        "userFeedback": user_messages[-3:],
                        "decisions": previous_summary.get("decisions") or [],
                        "openQuestions": previous_summary.get("openQuestions") or [],
                        "latestFocus": user_messages[-1] if user_messages else previous_summary.get("latestFocus", ""),
                        "artifactNotes": previous_summary.get("artifactNotes") or [],
                    }
                },
                save_payload={},
                warnings=[],
                metadata={"runtimeMode": "mock", "memorySummary": True},
            )
        response = self.loader.load(request)
        if response.metadata is None:
            response.metadata = {}
        response.metadata.setdefault("promptLoaded", bool(prompt))
        response.metadata.setdefault("promptTaskType", request.task_type)
        return response

    def decide_retrieval(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> RetrievalToolRequest | None:
        if request.task_type == "trend.track":
            saved_persona = request.context.get("savedPersona") or {}
            niche = saved_persona.get("niche") or {}
            primary_niche = niche.get("primary") or "小红书"
            user_preference = request.input.get("userPreference") or "热门选题"
            return RetrievalToolRequest(
                source="web_search",
                query=f"小红书 {primary_niche} {user_preference}",
                platform=request.platform,
                limit=request.options.get("maxToolCalls", 3) or 3,
                filters=self._filters(request, niche=primary_niche),
                timeoutMs=request.options.get("webSearchTimeoutMs", 15000),
            )
        if request.task_type == "persona.analyze":
            base_info = request.input.get("baseInfo") or {}
            occupation = base_info.get("occupation") or "用户"
            interests = base_info.get("interests") or []
            interest_text = " ".join(str(item) for item in interests[:3])
            return RetrievalToolRequest(
                source="web_search",
                query=f"小红书 {occupation} {interest_text} 人设 赛道 内容方向",
                platform=request.platform,
                limit=request.options.get("maxToolCalls", 3) or 3,
                filters=self._filters(request),
                timeoutMs=request.options.get("webSearchTimeoutMs", 15000),
            )
        if request.task_type == "content.draft":
            selected_topic = request.context.get("selectedTopic") or {}
            topic = (
                request.input.get("topic")
                or selected_topic.get("title")
                or selected_topic.get("startWritingInput", {}).get("topic")
                or "小红书 图文笔记"
            )
            return RetrievalToolRequest(
                source="web_search",
                query=f"小红书 {topic} 爆款 图文 笔记 写法",
                platform=request.platform,
                limit=request.options.get("maxToolCalls", 3) or 3,
                filters=self._filters(request),
                timeoutMs=request.options.get("webSearchTimeoutMs", 15000),
            )
        return None

    def _filters(self, request: AgentRunRequest, **extra: Any) -> dict[str, Any]:
        return {
            "contentType": request.options.get("contentType", "image_text_note"),
            "language": request.options.get("language", "zh-CN"),
            "debugAuth": request.options.get("debugAuth", {}),
            "allowMockFallback": not request.options.get("requireRealWebResearch", False),
            **extra,
        }
