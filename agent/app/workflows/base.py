from app.core.config import get_settings
from app.core.errors import MISSING_CONTEXT, MODEL_PROVIDER_UNAVAILABLE, failed_response
from app.orchestration.agent_orchestrator import AgentOrchestrator
from app.prompts.loader import PromptLoader
from app.runtime.base import ModelRuntime
from app.runtime.gemini_runtime import GeminiRuntime
from app.runtime.mock_runtime import MockRuntime
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.schemas.tools import RetrievalToolRequest, RetrievalToolResult, ToolCall
from app.tools.registry import ToolRegistry
from app.tools.retrieval import result_to_sources


class BaseWorkflow:
    def __init__(self, runtime: ModelRuntime | None = None) -> None:
        self.runtime = runtime
        self.prompt_loader = PromptLoader()
        self.orchestrator = AgentOrchestrator()

    def generate_response(self, request: AgentRunRequest) -> AgentRunResponse:
        runtime = self._runtime_for_request(request)
        if runtime is None:
            return self.model_provider_unavailable(request)
        plan = self.orchestrator.plan(request)
        role_request = self.orchestrator.with_model_role(request, plan.worker_role)
        response = runtime.generate(
            role_request,
            prompt=self._prompt_for_request(request),
            variables=self._variables_for_request(role_request),
        )
        if response.status != "failed":
            response.metadata["modelRole"] = plan.worker_role
            response.metadata["appliedSkills"] = self._applied_skills_for_request(role_request)
            response.metadata["webSearchDecision"] = "disabled"
            response.metadata["agentPlan"] = self.orchestrator.agent_plan_summary(
                plan,
                web_search_decision="disabled",
            )
            response.metadata["qualityChecks"] = self._quality_checks(
                response,
                source_status="not_required",
            )
            response.metadata["subAgentTrace"] = self.orchestrator.trace_metadata(
                plan,
                web_search_decision="disabled",
            )
        return response

    def generate_with_optional_retrieval(
        self,
        request: AgentRunRequest,
        *,
        metadata_key: str = "retrievalSource",
    ) -> AgentRunResponse:
        runtime = self._runtime_for_request(request)
        if runtime is None:
            return self.model_provider_unavailable(request)

        plan = self.orchestrator.plan(request)
        prompt = self._prompt_for_request(request)
        variables = self._variables_for_request(request)
        retrieval_result: RetrievalToolResult | None = None
        tool_calls: list[ToolCall] = []
        final_request = self.orchestrator.with_model_role(request, plan.worker_role)
        web_search_decision = "disabled"
        retrieval_reason = ""

        if request.options.get("enableTools", True):
            web_search_decision = "skipped_by_agent"
            search_request = self.orchestrator.with_model_role(request, plan.search_role)
            retrieval_request = runtime.decide_retrieval(
                search_request,
                prompt=prompt,
                variables=variables,
            )
            if retrieval_request is None and plan.force_retrieval:
                query = self.orchestrator.deterministic_retrieval_query(request)
                if query:
                    retrieval_request = RetrievalToolRequest(
                        source="web_search",
                        query=query,
                        platform=request.platform,
                        limit=request.options.get("maxToolCalls", 3) or 3,
                        filters={
                            "contentType": request.options.get("contentType", "image_text_note"),
                            "language": request.options.get("language", "zh-CN"),
                            "debugAuth": request.options.get("debugAuth", {}),
                            "decisionReason": "forced_by_task_policy",
                            "queries": self.orchestrator.deterministic_retrieval_queries(request),
                            "freshnessDays": request.options.get("freshnessDays", 30),
                            "sourcePreference": request.options.get("sourcePreference", "public_web"),
                        },
                        timeoutMs=request.options.get("webSearchTimeoutMs", 15000),
                    )
            if retrieval_request is not None:
                retrieval_reason = str((retrieval_request.filters or {}).get("decisionReason") or "").strip()
                web_search_decision = "attempted"
            if retrieval_request is not None:
                retrieval_request = self._normalize_retrieval_request(
                    request,
                    retrieval_request,
                )
                tool_registry = ToolRegistry(get_settings())
                if plan.force_retrieval:
                    retrieval_result, tool_calls = tool_registry.search_trend_evidence(
                        retrieval_request
                    )
                else:
                    retrieval_result, tool_calls = tool_registry.search_with_fallback(
                        retrieval_request
                    )
                if retrieval_result.status != "success" and not plan.force_retrieval:
                    return self._real_research_failed(request, tool_calls)
                final_request = self._request_with_retrieval_context(
                    final_request,
                    retrieval_result,
                    tool_calls,
                )

        final_prompt = self._prompt_with_retrieval_result(prompt, retrieval_result)
        response = runtime.generate(
            final_request,
            prompt=final_prompt,
            variables=self._variables_for_request(final_request),
        )
        if response.status == "failed":
            if tool_calls:
                response.tool_calls = [call.model_dump(mode="json") for call in tool_calls]
            return response

        if retrieval_result is None:
            response.metadata["modelRole"] = plan.worker_role
            response.metadata["appliedSkills"] = self._applied_skills_for_request(final_request)
            response.metadata["webSearchDecision"] = web_search_decision
            response.metadata["agentPlan"] = self.orchestrator.agent_plan_summary(
                plan,
                web_search_decision=web_search_decision,
                retrieval_reason=retrieval_reason,
            )
            response.metadata["qualityChecks"] = self._quality_checks(
                response,
                source_status="not_required" if web_search_decision == "skipped_by_agent" else "not_used",
            )
            response.metadata["subAgentTrace"] = self.orchestrator.trace_metadata(plan, web_search_decision=web_search_decision, retrieval_reason=retrieval_reason)
            return response

        response.tool_calls = [call.model_dump(mode="json") for call in tool_calls]
        response.sources = [
            source.model_dump(mode="json") for source in result_to_sources(retrieval_result)
        ]
        response.metadata[metadata_key] = retrieval_result.source
        response.metadata["modelRole"] = plan.worker_role
        response.metadata["appliedSkills"] = self._applied_skills_for_request(final_request)
        response.metadata["webSearchDecision"] = "used" if retrieval_result.status == "success" else "failed_open"
        response.metadata["evidenceSummary"] = self._evidence_summary(retrieval_result, tool_calls)
        response.metadata["agentPlan"] = self.orchestrator.agent_plan_summary(
            plan,
            web_search_decision=response.metadata["webSearchDecision"],
            retrieval_reason=retrieval_reason,
        )
        response.metadata["qualityChecks"] = self._quality_checks(
            response,
            source_status=retrieval_result.status,
            source_count=len(retrieval_result.items),
        )
        response.metadata["subAgentTrace"] = self.orchestrator.trace_metadata(plan, web_search_decision=response.metadata["webSearchDecision"], retrieval_source=retrieval_result.source, retrieval_reason=retrieval_reason)
        return response

    def _normalize_retrieval_request(
        self,
        request: AgentRunRequest,
        retrieval_request: RetrievalToolRequest,
    ) -> RetrievalToolRequest:
        requested_filters = retrieval_request.filters or {}
        filters = {
            **requested_filters,
            "contentType": requested_filters.get(
                "contentType",
                request.options.get("contentType", "image_text_note"),
            ),
            "language": requested_filters.get(
                "language",
                request.options.get("language", "zh-CN"),
            ),
            "debugAuth": request.options.get("debugAuth", {}),
        }
        deterministic_queries = self.orchestrator.deterministic_retrieval_queries(request)
        existing_queries = requested_filters.get("queries")
        if not isinstance(existing_queries, list) or not existing_queries:
            filters["queries"] = deterministic_queries or [retrieval_request.query]
        filters["freshnessDays"] = requested_filters.get(
            "freshnessDays",
            request.options.get("freshnessDays", 30),
        )
        filters["sourcePreference"] = requested_filters.get(
            "sourcePreference",
            request.options.get("sourcePreference", "public_web"),
        )
        limit = retrieval_request.limit or request.options.get("maxToolCalls", 3) or 3
        return retrieval_request.model_copy(
            update={
                "source": "web_search",
                "platform": request.platform,
                "limit": limit,
                "filters": filters,
            }
        )

    def _request_with_retrieval_context(
        self,
        request: AgentRunRequest,
        retrieval_result: RetrievalToolResult,
        tool_calls: list[ToolCall],
    ) -> AgentRunRequest:
        context = dict(request.context or {})
        context["retrievalResults"] = [
            item.model_dump(mode="json") for item in retrieval_result.items
        ]
        context["toolResults"] = [
            {
                "source": retrieval_result.source,
                "status": retrieval_result.status,
                "items": [item.model_dump(mode="json") for item in retrieval_result.items],
                "warnings": [
                    warning.model_dump(mode="json")
                    for warning in retrieval_result.warnings
                ],
                "error": (
                    retrieval_result.error.model_dump(mode="json")
                    if retrieval_result.error
                    else None
                ),
            }
        ]
        context["toolCalls"] = [call.model_dump(mode="json") for call in tool_calls]
        context["evidenceSummary"] = self._evidence_summary(retrieval_result, tool_calls)
        return request.model_copy(update={"context": context})

    def _evidence_summary(
        self,
        retrieval_result: RetrievalToolResult | None,
        tool_calls: list[ToolCall] | None = None,
    ) -> dict:
        if retrieval_result is None:
            return {
                "tier": "inferred",
                "label": "需要验证",
                "sourceType": "none",
                "sourceCount": 0,
                "validationKeywords": [],
                "limitations": "本轮没有使用外部检索结果，只能基于上下文做保守判断。",
            }
        if retrieval_result.status == "success":
            tier = "direct_xhs" if retrieval_result.source == "xhs_fetcher" else "public_web"
            label = "直接小红书证据" if tier == "direct_xhs" else "公开网页佐证"
            return {
                "tier": tier,
                "label": label,
                "sourceType": retrieval_result.source,
                "sourceCount": len(retrieval_result.items),
                "validationKeywords": self._validation_keywords_from_items(retrieval_result),
                "limitations": "工具结果用于选题判断，不代表官方热度排名。",
            }
        first_error = retrieval_result.error.message if retrieval_result.error else ""
        failed_sources = [
            str((call.inputSummary or {}).get("source"))
            for call in (tool_calls or [])
            if call.status == "failed" and (call.inputSummary or {}).get("source")
        ]
        return {
            "tier": "inferred",
            "label": "需要验证",
            "sourceType": "none",
            "sourceCount": 0,
            "failedSources": list(dict.fromkeys(failed_sources)),
            "validationKeywords": [],
            "limitations": first_error or "本轮未拿到可用检索结果，已降级为保守判断。",
        }

    def _validation_keywords_from_items(self, retrieval_result: RetrievalToolResult) -> list[str]:
        keywords: list[str] = []
        for item in retrieval_result.items[:3]:
            title = " ".join(str(item.title or "").split())
            if title and title not in keywords:
                keywords.append(title[:40])
        return keywords[:3]

    def _prompt_with_retrieval_result(
        self,
        prompt: str | None,
        retrieval_result: RetrievalToolResult | None,
    ) -> str | None:
        if retrieval_result is None:
            return prompt

        if (
            retrieval_result.source == "web_search"
            and retrieval_result.status == "success"
        ):
            guidance = (
                "Agent 已经在本轮最终生成前完成 web_search。"
                "最终回答必须优先参考以下真实检索结果；如果结果不足或相关性弱，"
                "需要明确说明不确定性，不得伪造来源、链接或平台数据。"
            )
        else:
            guidance = (
                "Agent 已经在本轮最终生成前尝试 web_search，但以下内容不是成功的真实检索结果。"
                "最终回答只能把它作为兜底参考；如果结果不足或相关性弱，"
                "需要明确说明不确定性，不得伪造来源、链接或平台数据。"
            )

        lines = [
            "",
            "## Web Search Results",
            guidance,
            f"source: {retrieval_result.source}",
            f"status: {retrieval_result.status}",
        ]
        if retrieval_result.error is not None:
            lines.append(f"error: {retrieval_result.error.message}")

        for index, item in enumerate(retrieval_result.items[:8], start=1):
            lines.extend(
                [
                    f"[{index}] {item.title}",
                    f"url: {item.url or ''}",
                    f"summary: {item.summary[:800]}",
                ]
            )

        retrieval_prompt = "\n".join(lines)
        if prompt and prompt.strip():
            return f"{prompt.rstrip()}\n\n{retrieval_prompt}"
        return retrieval_prompt.strip()

    def _runtime_for_request(self, request: AgentRunRequest) -> ModelRuntime | None:
        runtime_provider = str(request.options.get("runtimeProvider") or "").strip().lower()
        if runtime_provider == "mock":
            return MockRuntime()
        if runtime_provider == "gemini":
            return self._default_model_runtime()
        if runtime_provider == "model":
            return self._default_model_runtime()
        if self.runtime is not None:
            return self.runtime
        default_mode = self._default_runtime_mode()
        if default_mode == "mock":
            return MockRuntime()
        if default_mode in {"model", "gemini"}:
            return self._default_model_runtime()
        return None

    def _default_runtime_mode(self) -> str:
        settings = get_settings()
        if getattr(settings, "agent_runtime_mode", None):
            return str(settings.agent_runtime_mode).strip().lower()
        return "model"

    def _default_model_runtime(self) -> ModelRuntime:
        settings = get_settings()
        if getattr(settings, "model_api_key", ""):
            return GeminiRuntime(settings)
        return None

    def _prompt_for_request(self, request: AgentRunRequest) -> str | None:
        prompt_override = request.options.get("promptOverride")
        if isinstance(prompt_override, str) and prompt_override.strip():
            return self._prompt_with_skills(request, prompt_override)
        try:
            return self._prompt_with_skills(request, self.prompt_loader.load(request.task_type))
        except KeyError:
            return None

    def _prompt_with_skills(self, request: AgentRunRequest, prompt: str | None) -> str | None:
        skill_blocks = []
        for skill_name, skill_content in self.prompt_loader.load_skills_for_task(request.task_type):
            skill_blocks.append(f"## Applied Skill: {skill_name}\n\n{skill_content.strip()}")
        if not skill_blocks:
            return prompt
        skills_prompt = "\n\n".join(skill_blocks)
        if prompt and prompt.strip():
            return f"{prompt.rstrip()}\n\n{skills_prompt}"
        return skills_prompt

    def _applied_skills_for_request(self, request: AgentRunRequest) -> list[str]:
        return self.prompt_loader.skills_for_task(request.task_type)

    def _variables_for_request(self, request: AgentRunRequest) -> dict:
        return {
            "taskType": request.task_type,
            "platform": request.platform,
            "input": request.input,
            "context": request.context,
            "options": request.options,
        }

    def missing_context(
        self,
        request: AgentRunRequest,
        message: str,
        missing: list[str],
    ) -> AgentRunResponse:
        return failed_response(
            request,
            MISSING_CONTEXT,
            message,
            {"missing": missing},
        )

    def model_provider_unavailable(self, request: AgentRunRequest) -> AgentRunResponse:
        return failed_response(
            request,
            MODEL_PROVIDER_UNAVAILABLE,
            "Agent 未启用：模型 API Key 未配置，请配置 GOOGLE_API_KEY 或 MODEL_API_KEY 后重试。",
            {},
        )

    def _real_research_failed(
        self,
        request: AgentRunRequest,
        tool_calls: list[ToolCall],
    ) -> AgentRunResponse:
        response = failed_response(
            request,
            "REAL_WEB_RESEARCH_FAILED",
            "真实 Web Research 调用失败，当前版本不会再使用 mock 数据兜底。",
            {
                "firstToolError": (
                    tool_calls[0].error.model_dump(mode="json")
                    if tool_calls and tool_calls[0].error
                    else None
                )
            },
        )
        response.tool_calls = [call.model_dump(mode="json") for call in tool_calls]
        response.metadata["modelRole"] = self.orchestrator.plan(request).worker_role
        response.metadata["webSearchDecision"] = "failed"
        plan = self.orchestrator.plan(request)
        response.metadata["agentPlan"] = self.orchestrator.agent_plan_summary(
            plan,
            web_search_decision="failed",
            retrieval_reason="web_search_failed",
        )
        response.metadata["qualityChecks"] = self._quality_checks(
            response,
            source_status="failed",
        )
        response.metadata["recovery"] = {
            "action": "ask_user_or_retry",
            "message": "未拿到可靠公开资料，本轮不会使用 mock 数据伪造来源。",
        }
        return response

    def _quality_checks(
        self,
        response: AgentRunResponse,
        *,
        source_status: str,
        source_count: int = 0,
    ) -> dict:
        data = response.data if isinstance(response.data, dict) else {}
        return {
            "structuredOutput": "passed" if bool(data) else "empty",
            "sourceCheck": source_status,
            "sourceCount": source_count,
            "toolCallCount": len(response.tool_calls or []),
        }
