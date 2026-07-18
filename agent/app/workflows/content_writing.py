from app.core.errors import INVALID_REQUEST, failed_response
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.workflows.base import BaseWorkflow


class ContentWritingWorkflow(BaseWorkflow):
    def __init__(self) -> None:
        super().__init__()

    def run(self, request: AgentRunRequest) -> AgentRunResponse:
        if request.task_type == "content.draft":
            return self.draft(request)
        if request.task_type == "content.revise":
            return self.revise(request)
        return failed_response(
            request,
            INVALID_REQUEST,
            "内容撰写 workflow 不支持该任务。",
            {"taskType": request.task_type},
        )

    def draft(self, request: AgentRunRequest) -> AgentRunResponse:
        missing = []
        if not request.context.get("savedPersona"):
            missing.append("context.savedPersona")
        if not request.context.get("selectedTopic") and not request.input.get("topic"):
            missing.append("context.selectedTopic or input.topic")
        if missing:
            return self.missing_context(
                request,
                "内容撰写需要先完成人设打造，并选择一个选题。",
                missing,
            )
        return self.generate_with_optional_retrieval(
            request,
            metadata_key="researchSource",
        )

    def revise(self, request: AgentRunRequest) -> AgentRunResponse:
        missing = []
        if not request.context.get("currentDraft"):
            missing.append("context.currentDraft")
        if not request.context.get("savedPersona"):
            missing.append("context.savedPersona")
        if not request.input.get("revisionInstruction"):
            missing.append("input.revisionInstruction")
        if missing:
            return self.missing_context(
                request,
                "内容修改需要已有草稿、人设和修改意见。",
                missing,
            )
        response = self.generate_response(request)
        if response.status == "failed":
            return response
        return response
