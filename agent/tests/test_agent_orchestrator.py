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
    assert trend_plan.strategy == "plan_act_check_v1"
    assert trend_plan.task_stage == "trending"
    assert trend_plan.objective == "turn_public_research_into_xhs_topics"
    assert trend_plan.search_role == "search"
    assert trend_plan.worker_role == "trend"
    assert trend_plan.quality_role == "quality"
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


def test_orchestrator_builds_multiple_retrieval_queries() -> None:
    request = AgentRunRequest(
        requestId="r1",
        taskType="trend.track",
        platform="xiaohongshu",
        userId="u1",
        input={"userPreference": "修仙文吐槽"},
        context={"savedPersona": {"title": "网文吐槽记录"}},
    )

    queries = AgentOrchestrator().deterministic_retrieval_queries(request)

    assert 2 <= len(queries) <= 3
    assert all("小红书" in query or "用户需求" in query for query in queries)


def test_orchestrator_debug_trace_includes_quality_agent() -> None:
    request = AgentRunRequest(
        requestId="r1",
        taskType="content.draft",
        platform="xiaohongshu",
        userId="u1",
        options={"debugAgentTrace": True},
    )
    orchestrator = AgentOrchestrator()
    plan = orchestrator.plan(request)

    trace = orchestrator.trace_metadata(plan, web_search_decision="skipped_by_agent")

    assert trace["mainAgent"]["responsibility"] == "plan_delegate_recover"
    assert trace["workerAgent"]["modelRole"] == "content"
    assert trace["qualityAgent"]["modelRole"] == "quality"
    assert trace["agentPlan"]["objective"] == "write_or_revise_xhs_image_text_note"
    assert "selected_topic" in trace["agentPlan"]["knownContext"]
