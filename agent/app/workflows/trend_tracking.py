from app.core.errors import INVALID_REQUEST, failed_response
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.workflows.base import BaseWorkflow


class TrendTrackingWorkflow(BaseWorkflow):
    def __init__(self) -> None:
        super().__init__()

    def run(self, request: AgentRunRequest) -> AgentRunResponse:
        if request.task_type == "trend.track":
            return self.track(request)
        if request.task_type == "topic.recommend":
            return self.recommend_topic(request)
        return failed_response(
            request,
            INVALID_REQUEST,
            "热门追踪 workflow 不支持该任务。",
            {"taskType": request.task_type},
        )

    def track(self, request: AgentRunRequest) -> AgentRunResponse:
        if not request.context.get("savedPersona"):
            return self.missing_context(
                request,
                "热门追踪需要先保存人设信息。",
                ["context.savedPersona"],
            )

        return self.generate_with_optional_retrieval(
            request,
            metadata_key="retrievalSource",
        )

    def recommend_topic(self, request: AgentRunRequest) -> AgentRunResponse:
        missing = []
        if not request.context.get("savedPersona"):
            missing.append("context.savedPersona")
        if not request.context.get("trendSnapshot"):
            missing.append("context.trendSnapshot")
        if missing:
            return self.missing_context(
                request,
                "选题推荐需要已保存人设和趋势快照。",
                missing,
            )
        response = self.generate_response(request)
        if response.status == "failed":
            return response
        return response
