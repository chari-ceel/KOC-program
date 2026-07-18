from app.core.errors import INVALID_REQUEST, failed_response
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.workflows.base import BaseWorkflow


class GeneralChatWorkflow(BaseWorkflow):
    def run(self, request: AgentRunRequest) -> AgentRunResponse:
        if request.task_type == "memory.summarize_conversation":
            return self.generate_response(request)
        if request.task_type != "general.chat":
            return failed_response(
                request,
                INVALID_REQUEST,
                "通用聊天 workflow 不支持该任务。",
                {"taskType": request.task_type},
            )
        if not request.input.get("userMessage"):
            return failed_response(
                request,
                INVALID_REQUEST,
                "通用聊天缺少用户消息。",
                {"missing": ["input.userMessage"]},
            )
        return self.generate_response(request)
