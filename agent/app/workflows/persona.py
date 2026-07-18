from app.core.errors import INVALID_REQUEST, failed_response
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.workflows.base import BaseWorkflow


class PersonaWorkflow(BaseWorkflow):
    def __init__(self) -> None:
        super().__init__()

    def run(self, request: AgentRunRequest) -> AgentRunResponse:
        if request.task_type == "persona.analyze":
            return self.analyze(request)
        if request.task_type == "persona.follow_up":
            return self.follow_up(request)
        return failed_response(
            request,
            INVALID_REQUEST,
            "人设 workflow 不支持该任务。",
            {"taskType": request.task_type},
        )

    def analyze(self, request: AgentRunRequest) -> AgentRunResponse:
        if not request.input.get("baseInfo"):
            return failed_response(
                request,
                INVALID_REQUEST,
                "缺少用户基础信息。",
                {"missing": ["input.baseInfo"]},
            )
        return self.generate_with_optional_retrieval(
            request,
            metadata_key="researchSource",
        )

    def follow_up(self, request: AgentRunRequest) -> AgentRunResponse:
        missing = []
        if not request.input.get("userMessage"):
            missing.append("input.userMessage")
        if "baseInfo" not in request.context:
            missing.append("context.baseInfo")
        if "conversationHistory" not in request.context:
            missing.append("context.conversationHistory")
        if missing:
            return failed_response(
                request,
                INVALID_REQUEST,
                "人设追问缺少必要输入或上下文。",
                {"missing": missing},
            )
        response = self.generate_response(request)
        if response.status == "failed":
            return response
        return response
