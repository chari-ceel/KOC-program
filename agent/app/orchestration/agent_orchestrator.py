from __future__ import annotations

from dataclasses import dataclass

from app.schemas.agent import AgentRunRequest


@dataclass(frozen=True)
class AgentExecutionPlan:
    main_role: str
    search_role: str
    worker_role: str
    force_retrieval: bool = False
    expose_trace: bool = False


class AgentOrchestrator:
    """Lightweight fixed-role dispatcher for the first sub-agent iteration."""

    def plan(self, request: AgentRunRequest) -> AgentExecutionPlan:
        task_type = request.task_type
        worker_role = self._worker_role_for_task(task_type)
        return AgentExecutionPlan(
            main_role="main",
            search_role="search",
            worker_role=worker_role,
            force_retrieval=task_type == "trend.track",
            expose_trace=bool(request.options.get("debugAgentTrace")),
        )

    def with_model_role(self, request: AgentRunRequest, role: str) -> AgentRunRequest:
        options = dict(request.options or {})
        options["modelRole"] = role
        return request.model_copy(update={"options": options})

    def trace_metadata(
        self,
        plan: AgentExecutionPlan,
        *,
        web_search_decision: str,
        retrieval_source: str | None = None,
        retrieval_reason: str | None = None,
    ) -> dict:
        trace = {
            "strategy": "fixed_role_v1",
            "mainAgent": {"modelRole": plan.main_role, "responsibility": "plan_and_merge"},
            "searchAgent": {
                "modelRole": plan.search_role,
                "responsibility": "query_public_sources",
                "decision": web_search_decision,
                "source": retrieval_source,
                "reason": retrieval_reason or "",
            },
            "workerAgent": {"modelRole": plan.worker_role, "responsibility": "module_generation"},
        }
        return trace if plan.expose_trace else {"strategy": trace["strategy"]}

    def deterministic_retrieval_query(self, request: AgentRunRequest) -> str:
        if request.task_type == "trend.track":
            saved_persona = request.context.get("savedPersona") or {}
            preference = str(request.input.get("userPreference") or request.input.get("preference") or "").strip()
            persona_hint = ""
            if isinstance(saved_persona, dict):
                persona_hint = str(
                    saved_persona.get("title")
                    or saved_persona.get("personaName")
                    or saved_persona.get("summary")
                    or ""
                ).strip()
            parts = ["小红书", persona_hint, preference, "近期 热门 选题 趋势 图文"]
            return " ".join(part for part in parts if part)[:240]
        topic = str(request.input.get("topic") or "").strip()
        if request.task_type.startswith("content.") and topic:
            return f"小红书 {topic} 近期 选题 参考 图文"[:240]
        return ""

    def _worker_role_for_task(self, task_type: str) -> str:
        if task_type.startswith("content."):
            return "content"
        if task_type in {"trend.track", "topic.recommend"}:
            return "trend"
        if task_type.startswith("persona."):
            return "persona"
        return "lightweight"
