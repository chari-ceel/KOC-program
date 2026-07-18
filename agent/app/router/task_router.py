from app.core.errors import (
    INTERNAL_ERROR,
    UNSUPPORTED_PLATFORM,
    UNSUPPORTED_TASK_TYPE,
    failed_response,
)
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.workflows.content_writing import ContentWritingWorkflow
from app.workflows.general_chat import GeneralChatWorkflow
from app.workflows.persona import PersonaWorkflow
from app.workflows.trend_tracking import TrendTrackingWorkflow


SUPPORTED_TASKS = [
    "general.chat",
    "memory.summarize_conversation",
    "persona.analyze",
    "persona.follow_up",
    "trend.track",
    "topic.recommend",
    "content.draft",
    "content.revise",
]

RESERVED_TASKS = [
    "context.plan",
    "analytics.insight",
    "operation.plan",
    "douyin.content_draft",
    "bilibili.content_draft",
]


class TaskRouter:
    def __init__(self) -> None:
        self.persona_workflow = PersonaWorkflow()
        self.trend_workflow = TrendTrackingWorkflow()
        self.content_workflow = ContentWritingWorkflow()
        self.general_chat_workflow = GeneralChatWorkflow()

    def route(self, request: AgentRunRequest) -> AgentRunResponse:
        if request.platform != "xiaohongshu":
            return failed_response(
                request,
                UNSUPPORTED_PLATFORM,
                "一期只支持小红书。",
                {"platform": request.platform},
            )

        if request.task_type in RESERVED_TASKS or request.task_type not in SUPPORTED_TASKS:
            return failed_response(
                request,
                UNSUPPORTED_TASK_TYPE,
                "当前不支持该 taskType。",
                {"taskType": request.task_type},
            )

        try:
            if request.task_type in {"general.chat", "memory.summarize_conversation"}:
                return self.general_chat_workflow.run(request)
            if request.task_type.startswith("persona."):
                return self.persona_workflow.run(request)
            if request.task_type in {"trend.track", "topic.recommend"}:
                return self.trend_workflow.run(request)
            if request.task_type.startswith("content."):
                return self.content_workflow.run(request)
        except Exception as exc:
            return failed_response(
                request,
                INTERNAL_ERROR,
                "Agent workflow 执行失败。",
                {"error": str(exc)},
            )

        return failed_response(
            request,
            UNSUPPORTED_TASK_TYPE,
            "当前不支持该 taskType。",
            {"taskType": request.task_type},
        )
