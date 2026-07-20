from app.orchestration.agent_orchestrator import AgentOrchestrator
from app.schemas.agent import AgentRunRequest


def test_orchestrator_assigns_fixed_roles_for_trend_and_content() -> None:
    orchestrator = AgentOrchestrator()
    trend_request = AgentRunRequest(
        requestId="r1",
        taskType="trend.track",
        platform="xiaohongshu",
        userId="u1",
        context={"savedPersona": {"title": "校园成长"}},
    )
    content_request = AgentRunRequest(
        requestId="r2",
        taskType="content.draft",
        platform="xiaohongshu",
        userId="u1",
        input={"topic": "考证规划"},
        context={"savedPersona": {"title": "校园成长"}},
    )

    trend_plan = orchestrator.plan(trend_request)
    content_plan = orchestrator.plan(content_request)

    assert trend_plan.main_role == "main"
    assert trend_plan.search_role == "search"
    assert trend_plan.worker_role == "trend"
    assert trend_plan.force_retrieval is True
    assert content_plan.worker_role == "content"
    assert content_plan.force_retrieval is False


def test_orchestrator_writes_model_role_into_request_options() -> None:
    request = AgentRunRequest(
        requestId="r1",
        taskType="content.draft",
        platform="xiaohongshu",
        userId="u1",
    )

    next_request = AgentOrchestrator().with_model_role(request, "content")

    assert next_request.options["modelRole"] == "content"
    assert "modelRole" not in request.options
