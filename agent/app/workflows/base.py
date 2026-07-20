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
            response.metadata["webSearchDecision"] = "disabled"
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
                retrieval_result, tool_calls = tool_registry.search_with_fallback(
                    retrieval_request
                )
                if retrieval_result.status != "success":
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
            response.metadata["webSearchDecision"] = web_search_decision
            response.metadata["subAgentTrace"] = self.orchestrator.trace_metadata(plan, web_search_decision=web_search_decision, retrieval_reason=retrieval_reason)
            return response

        response.tool_calls = [call.model_dump(mode="json") for call in tool_calls]
        response.sources = [
            source.model_dump(mode="json") for source in result_to_sources(retrieval_result)
        ]
        response.metadata[metadata_key] = retrieval_result.source
        response.metadata["modelRole"] = plan.worker_role
        response.metadata["webSearchDecision"] = "used"
        response.metadata["subAgentTrace"] = self.orchestrator.trace_metadata(plan, web_search_decision="used", retrieval_source=retrieval_result.source, retrieval_reason=retrieval_reason)
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
        return request.model_copy(update={"context": context})

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
            return prompt_override
        try:
            return self.prompt_loader.load(request.task_type)
        except KeyError:
            return None

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
        return response
