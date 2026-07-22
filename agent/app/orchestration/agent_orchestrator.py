from __future__ import annotations

from dataclasses import dataclass

from app.schemas.agent import AgentRunRequest


@dataclass(frozen=True)
class AgentExecutionPlan:
    strategy: str
    task_stage: str
    objective: str
    main_role: str
    search_role: str
    worker_role: str
    quality_role: str
    force_retrieval: bool = False
    expose_trace: bool = False


class AgentOrchestrator:
    """Lightweight plan-act-check dispatcher for the current Agent iteration."""

    def plan(self, request: AgentRunRequest) -> AgentExecutionPlan:
        task_type = request.task_type
        worker_role = self._worker_role_for_task(task_type)
        return AgentExecutionPlan(
            strategy="plan_act_check_v1",
            task_stage=self._stage_for_task(task_type),
            objective=self._objective_for_task(task_type),
            main_role="main",
            search_role="search",
            worker_role=worker_role,
            quality_role="quality",
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
            "strategy": plan.strategy,
            "agentPlan": self.agent_plan_summary(
                plan,
                web_search_decision=web_search_decision,
                retrieval_reason=retrieval_reason,
            ),
            "mainAgent": {"modelRole": plan.main_role, "responsibility": "plan_delegate_recover"},
            "searchAgent": {
                "modelRole": plan.search_role,
                "responsibility": "query_public_sources",
                "decision": web_search_decision,
                "source": retrieval_source,
                "reason": retrieval_reason or "",
            },
            "workerAgent": {"modelRole": plan.worker_role, "responsibility": "module_generation"},
            "qualityAgent": {"modelRole": plan.quality_role, "responsibility": "validate_before_user_visible"},
        }
        return trace if plan.expose_trace else {"strategy": trace["strategy"]}

    def agent_plan_summary(
        self,
        plan: AgentExecutionPlan,
        *,
        web_search_decision: str,
        retrieval_reason: str | None = None,
    ) -> dict:
        return {
            "strategy": plan.strategy,
            "stage": plan.task_stage,
            "objective": plan.objective,
            "knownContext": self._known_context_for_stage(plan.task_stage),
            "workerRole": plan.worker_role,
            "qualityRole": plan.quality_role,
            "searchDecision": web_search_decision,
            "action": "search_then_generate" if web_search_decision in {"attempted", "used"} else "generate_from_context",
            "missingContext": self._default_missing_context_for_stage(plan.task_stage),
            "note": retrieval_reason or "",
        }

    def deterministic_retrieval_query(self, request: AgentRunRequest) -> str:
        queries = self.deterministic_retrieval_queries(request)
        return queries[0] if queries else ""

    def deterministic_retrieval_queries(self, request: AgentRunRequest) -> list[str]:
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
            queries = [
                " ".join(part for part in ["小红书", persona_hint, preference, "近30天 热门 选题 趋势 图文"] if part),
                " ".join(part for part in ["小红书", preference, "爆款笔记 封面 标题 图文"] if part),
                " ".join(part for part in [persona_hint, preference, "小红书 用户需求 内容灵感"] if part),
            ]
            return self._unique_queries(queries)
        topic = str(request.input.get("topic") or "").strip()
        if request.task_type.startswith("content.") and topic:
            return self._unique_queries(
                [
                    f"小红书 {topic} 近30天 选题 参考 图文",
                    f"小红书 {topic} 爆款标题 封面 正文",
                ]
            )
        return []

    def _worker_role_for_task(self, task_type: str) -> str:
        if task_type.startswith("content."):
            return "content"
        if task_type in {"trend.track", "topic.recommend"}:
            return "trend"
        if task_type.startswith("persona."):
            return "persona"
        return "lightweight"

    def _stage_for_task(self, task_type: str) -> str:
        if task_type.startswith("persona."):
            return "persona"
        if task_type in {"trend.track", "topic.recommend"}:
            return "trending"
        if task_type.startswith("content."):
            return "content"
        return "general"

    def _unique_queries(self, queries: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for query in queries:
            cleaned = " ".join(str(query or "").split())[:240]
            if not cleaned or cleaned in seen:
                continue
            result.append(cleaned)
            seen.add(cleaned)
            if len(result) >= 3:
                break
        return result

    def _objective_for_task(self, task_type: str) -> str:
        if task_type == "persona.analyze":
            return "understand_user_identity_and_start_persona"
        if task_type == "persona.follow_up":
            return "refine_persona_with_next_questions"
        if task_type in {"trend.track", "topic.recommend"}:
            return "turn_public_research_into_xhs_topics"
        if task_type.startswith("content."):
            return "write_or_revise_xhs_image_text_note"
        return "answer_lightweight_request"

    def _known_context_for_stage(self, stage: str) -> list[str]:
        if stage == "persona":
            return ["conversation_history", "user_profile_inputs"]
        if stage == "trending":
            return ["saved_persona", "conversation_history", "retrieval_results_when_available"]
        if stage == "content":
            return ["saved_persona", "selected_topic", "latest_trend_snapshot", "current_draft_when_revising"]
        return ["conversation_history"]

    def _default_missing_context_for_stage(self, stage: str) -> list[str]:
        if stage == "persona":
            return ["identity", "interest", "share_style"]
        if stage == "trending":
            return ["fresh_public_sources_when_search_fails"]
        if stage == "content":
            return ["specific_topic_or_revision_instruction"]
        return []
