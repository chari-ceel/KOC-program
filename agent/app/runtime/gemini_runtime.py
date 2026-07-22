from __future__ import annotations

import json
import time
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.errors import MODEL_PROVIDER_UNAVAILABLE, failed_response
from app.runtime.base import ModelRuntime
from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.schemas.tools import RetrievalToolRequest


class GeminiRuntime(ModelRuntime):
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def generate(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> AgentRunResponse:
        debug_auth = request.options.get("debugAuth", {})
        api_key = ""
        base_url = self.settings.model_base_url
        model = self._model_for_request(request)
        if self.settings.enable_debug_auth and isinstance(debug_auth, dict):
            api_key = str(
                debug_auth.get("modelApiKey")
                or debug_auth.get("googleApiKey")
                or debug_auth.get("geminiApiKey")
                or ""
            ).strip()
            base_url = str(
                debug_auth.get("modelBaseUrl")
                or debug_auth.get("googleBaseUrl")
                or debug_auth.get("geminiBaseUrl")
                or base_url
            ).strip()
            model = str(
                debug_auth.get("modelName")
                or debug_auth.get("googleModel")
                or debug_auth.get("geminiModel")
                or debug_auth.get(f"{self._model_role_for_request(request)}Model")
                or model
            ).strip()
        api_key = api_key or self.settings.model_api_key

        if not api_key:
            return failed_response(
                request,
                MODEL_PROVIDER_UNAVAILABLE,
                "Agent 未启用：模型 API Key 未配置，请配置 GOOGLE_API_KEY 或 MODEL_API_KEY 后重试。",
                {},
            )

        started = time.perf_counter()
        schema = self._schema_for_task(request)
        system_instruction = prompt or "你是 KOC Agent 的结构化输出引擎。只输出 JSON，不要输出 Markdown。字段必须符合用户给定 schema。"

        try:
            max_output_tokens = 8192
            if request.task_type == "persona.analyze":
                max_output_tokens = 4096

            response = self._call_openai_compatible_chat(
                api_key=api_key,
                base_url=base_url,
                model=model,
                system_instruction=system_instruction,
                request=request,
                schema=schema,
                variables=variables or {},
                max_output_tokens=max_output_tokens,
            )
            content = self._extract_message_content(response)
            generated = self._parse_json_content(content)
        except Exception as exc:
            return failed_response(
                request,
                MODEL_PROVIDER_UNAVAILABLE,
                f"Agent 未启用或模型服务不可用：{str(exc)}",
                {"durationMs": int((time.perf_counter() - started) * 1000)},
            )

        data = generated.get("data", generated)
        save_payload = generated.get(
            "savePayload",
            self._default_save_payload(request, data or {}),
        )
        normalized_save_payload = self._normalize_save_payload(
            request,
            save_payload or {},
            data or {},
        )
        return AgentRunResponse(
            requestId=request.request_id,
            taskType=request.task_type,
            platform=request.platform,
            status="success",
            data=data,
            savePayload=normalized_save_payload,
            sources=[],
            toolCalls=[],
            warnings=[],
            metadata={
                "runtimeMode": "model",
                "mockResponse": False,
                "modelProvider": "openai_compatible",
                "model": model,
                "modelRole": self._model_role_for_request(request),
                "baseUrl": self._chat_completions_url(base_url),
                "promptLoaded": bool(prompt),
                "durationMs": int((time.perf_counter() - started) * 1000),
            },
        )

    def decide_retrieval(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> RetrievalToolRequest | None:
        debug_auth = request.options.get("debugAuth", {})
        api_key = ""
        base_url = self.settings.model_base_url
        model = self._model_for_request(request)
        if self.settings.enable_debug_auth and isinstance(debug_auth, dict):
            api_key = str(
                debug_auth.get("modelApiKey")
                or debug_auth.get("googleApiKey")
                or debug_auth.get("geminiApiKey")
                or ""
            ).strip()
            base_url = str(
                debug_auth.get("modelBaseUrl")
                or debug_auth.get("googleBaseUrl")
                or debug_auth.get("geminiBaseUrl")
                or base_url
            ).strip()
            model = str(
                debug_auth.get("modelName")
                or debug_auth.get("googleModel")
                or debug_auth.get("geminiModel")
                or debug_auth.get(f"{self._model_role_for_request(request)}Model")
                or model
            ).strip()
        api_key = api_key or self.settings.model_api_key
        if not api_key:
            return None

        decision_schema = {
            "useWebSearch": "boolean",
            "query": "string, concise web search query when useWebSearch is true",
            "reason": "string, short reason for the decision",
        }
        decision_instruction = (
            "你是 KOC Agent 的工具调度器。"
            "请判断当前任务是否需要调用 web_search。"
            "不要根据固定关键词做判断，基于任务目标、上下文新鲜度需求、用户输入和可用上下文自行决定。"
            "KOC 生产任务的默认策略：trend.track 依赖近期平台趋势和外部证据，通常需要 web_search；"
            "persona.analyze 和 content.draft 如果涉及平台定位、同赛道方向、内容写法参考、选题验证或用户需求判断，通常需要 web_search。"
            "只有当用户明确要求不查外部资料、当前上下文已经提供足够且可信的近期来源，或任务只是闲聊/改写/解释已有内容时，才返回 useWebSearch=false。"
            "如果决定搜索，请给出适合搜索引擎的中文 query。"
            "只输出 JSON。"
        )
        payload = {
            "taskType": request.task_type,
            "platform": request.platform,
            "input": request.input,
            "context": request.context,
            "options": {
                key: value
                for key, value in request.options.items()
                if key not in {"debugAuth", "promptOverride"}
            },
            "schema": decision_schema,
            "promptSummary": (prompt or "")[:1600],
            "variables": variables or {},
        }

        try:
            response = self._call_openai_compatible_chat(
                api_key=api_key,
                base_url=base_url,
                model=model,
                system_instruction=decision_instruction,
                request=request,
                schema=decision_schema,
                variables={"retrievalDecisionInput": payload},
                max_output_tokens=512,
            )
            content = self._extract_message_content(response)
            decision = self._parse_json_content(content)
        except Exception:
            return None

        if not bool(decision.get("useWebSearch")):
            return None
        query = str(decision.get("query") or "").strip()
        if not query:
            return None
        return RetrievalToolRequest(
            source="web_search",
            query=query[:240],
            platform=request.platform,
            limit=request.options.get("maxToolCalls", 3) or 3,
            filters={
                "contentType": request.options.get("contentType", "image_text_note"),
                "language": request.options.get("language", "zh-CN"),
                "debugAuth": request.options.get("debugAuth", {}),
                "decisionReason": str(decision.get("reason") or "").strip(),
            },
            timeoutMs=request.options.get("webSearchTimeoutMs", 15000),
        )

    def _model_role_for_request(self, request: AgentRunRequest) -> str:
        role = str(request.options.get("modelRole") or "").strip().lower()
        return role or "default"

    def _model_for_request(self, request: AgentRunRequest) -> str:
        role = self._model_role_for_request(request)
        role_model = {
            "main": self.settings.model_role_main,
            "search": self.settings.model_role_search,
            "trend": self.settings.model_role_trend,
            "content": self.settings.model_role_content,
            "persona": self.settings.model_role_persona,
            "lightweight": self.settings.model_role_lightweight,
        }.get(role, "")
        return (role_model or self.settings.model_name).strip()

    def _schema_for_task(self, request: AgentRunRequest) -> dict[str, Any]:
        if request.task_type == "persona.analyze":
            return {
                "data": {
                    "isReadyToSave": "boolean",
                    "persona": {
                        "name": "string, short persona label for the user's account direction, ideally 4-12 Chinese characters, not a full sentence",
                        "description": "string",
                    },
                    "niche": {"primary": "string", "secondary": ["string"]},
                    "audience": ["string"],
                    "contentStyle": ["string"],
                    "cardPreview": {
                        "personaLabel": "string, hidden summary card label only, short but informative phrase, ideally 6-14 Chinese characters",
                        "baseProfile": "string, hidden summary card base profile only, terms separated with ' · ', max about 16 display characters",
                        "keywordsLabel": "string, hidden summary card keywords only, 2-3 short keywords separated with ' · ', max about 16 display characters",
                        "audienceLabel": "string, hidden summary card target audience only, short audience phrase, ideally 6-14 Chinese characters",
                        "toneLabel": "string, hidden summary card tone only, ideally 6-12 Chinese characters",
                    },
                    "referenceCreatorDirections": ["string"],
                    "followUpQuestions": ["string, optional dynamic follow-up questions, max 3 items"],
                },
                "savePayload": {
                    "type": "persona_result",
                    "suggestedCollection": "persona_results",
                    "data": "same as useful persona data",
                },
            }
        if request.task_type == "persona.follow_up":
            return {
                "data": {
                    "reply": "string, normal conversational answer; do not shorten this to match cardPreview",
                    "nextQuestions": ["string"],
                    "isReadyToSave": "boolean",
                    "personaDraft": {
                        "persona": {
                            "name": "string, short persona label for the user's account direction, ideally 4-12 Chinese characters, not a full sentence",
                            "description": "string, normal persona description; do not shorten this to match cardPreview",
                        },
                        "niche": {"primary": "string", "secondary": ["string"]},
                        "audience": ["string"],
                        "contentStyle": ["string"],
                        "cardPreview": {
                            "personaLabel": "string, hidden summary card label only, short but informative phrase, ideally 6-14 Chinese characters",
                            "baseProfile": "string, hidden summary card base profile only, terms separated with ' · ', max about 16 display characters",
                            "keywordsLabel": "string, hidden summary card keywords only, 2-3 short keywords separated with ' · ', max about 16 display characters",
                            "audienceLabel": "string, hidden summary card target audience only, short audience phrase, ideally 6-14 Chinese characters",
                            "toneLabel": "string, hidden summary card tone only, ideally 6-12 Chinese characters",
                        },
                    },
                },
                "savePayload": {
                    "type": "persona_conversation_turn",
                    "suggestedCollection": "persona_conversations",
                    "data": "conversation turn and useful persona draft data",
                },
            }
        if request.task_type == "trend.track":
            return {
                "data": {
                    "reply": "string, optional conversational answer for discussion turns",
                    "isReadyToSave": "boolean",
                    "trendSummary": {
                        "period": "string",
                        "platform": "xiaohongshu",
                        "niche": "string",
                        "summary": "string",
                    },
                    "hotTrends": [
                        {"name": "string", "reason": "string", "heatLevel": "high|medium|low"}
                    ],
                    "audienceNeeds": [
                        {"need": "string", "evidence": "string", "confidence": "high|medium|low"}
                    ],
                    "topicOpportunities": [
                        {
                            "title": "string, direct xiaohongshu image-text note title, max 20 Chinese characters; return exactly 3 items",
                            "angle": "string",
                            "fitReason": "string",
                            "difficulty": "low|medium|high",
                        }
                    ],
                    "cardPreview": {
                        "discoveryKeywords": ["string, 2-3 short trend keywords"],
                        "shortTopics": ["string, 2-3 short topic phrases"],
                    },
                },
                "savePayload": {
                    "type": "trend_tracking_result",
                    "suggestedCollection": "trend_tracking_results",
                    "data": "compact trend data",
                },
            }
        if request.task_type == "content.draft":
            return {
                "data": {
                    "reply": "string, optional conversational answer for discussion turns",
                    "isReadyToSave": "boolean",
                        "draft": {
                            "titleOptions": ["string, 3 options, each max 20 Chinese characters"],
                            "selectedTitle": "string, max 20 Chinese characters",
                            "intro": "string",
                            "body": "string",
                            "ending": "string",
                            "tags": ["string, 3-5 xiaohongshu tags"],
                        "coverSuggestion": {
                            "mainText": "string",
                            "layout": "string",
                            "visualStyle": "string",
                        },
                        "imageTextStructure": ["string"],
                        "cardPreview": {
                            "keywords": ["string, 2-3 short keywords"],
                        },
                    },
                    "suggestions": [
                        {"label": "string", "instruction": "string", "intent": "title_optimize|intro_optimize|body_expand|humanize|tag_optimize"}
                    ],
                },
                "savePayload": {
                    "type": "content_draft",
                    "suggestedCollection": "content_drafts",
                    "data": "compact draft data",
                },
            }
        if request.task_type == "content.revise":
            return {
                "data": {
                    "reply": "string, optional short explanation for applied changes",
                    "isReadyToSave": "boolean",
                    "revisedDraft": {
                        "titleOptions": ["string, 3 options, each max 20 Chinese characters"],
                        "selectedTitle": "string, max 20 Chinese characters",
                        "intro": "string",
                        "body": "string",
                        "ending": "string",
                        "tags": ["string, 3-5 xiaohongshu tags"],
                        "coverSuggestion": {
                            "mainText": "string",
                            "layout": "string",
                            "visualStyle": "string",
                        },
                        "imageTextStructure": ["string"],
                        "cardPreview": {
                            "keywords": ["string, 2-3 short keywords"],
                        },
                    },
                    "changes": [
                        {"field": "string", "reason": "string"}
                    ],
                    "suggestions": [
                        {"label": "string", "instruction": "string", "intent": "title_optimize|intro_optimize|body_expand|humanize|tag_optimize"}
                    ],
                },
                "savePayload": {
                    "type": "content_revision",
                    "suggestedCollection": "content_drafts",
                    "data": "compact revised draft data",
                },
            }
        if request.task_type == "general.chat":
            return {
                "data": {
                    "reply": "string",
                    "suggestedActions": [
                        {"label": "string", "taskType": "string"}
                    ],
                },
                "savePayload": {
                    "type": "general_chat_turn",
                    "suggestedCollection": "agent_conversations",
                    "data": "chat turn data",
                },
            }
        if request.task_type == "memory.summarize_conversation":
            return {
                "data": {
                    "conversationSummary": {
                        "version": "string",
                        "scene": "string",
                        "coveredMessageCount": "number",
                        "userGoal": "string",
                        "confirmedFacts": ["string"],
                        "assistantFindings": ["string"],
                        "userFeedback": ["string"],
                        "decisions": ["string"],
                        "openQuestions": ["string"],
                        "latestFocus": "string",
                        "artifactNotes": ["string"],
                    }
                },
                "savePayload": {},
            }
        return {"data": {}, "savePayload": {}}

    def _normalize_base_url(self, base_url: str) -> str:
        cleaned = base_url.strip().rstrip("/")
        if cleaned.endswith("/google/v1beta"):
            cleaned = cleaned[: -len("/google/v1beta")]
        if cleaned.endswith("/google/v1"):
            cleaned = cleaned[: -len("/google/v1")]
        if cleaned.endswith("/v1beta"):
            cleaned = cleaned[: -len("/v1beta")]
        if cleaned.endswith("/v1"):
            cleaned = cleaned[: -len("/v1")]
        return cleaned

    def _chat_completions_url(self, base_url: str) -> str:
        normalized = self._normalize_base_url(base_url)
        if normalized.endswith("/api/v3"):
            return f"{normalized}/chat/completions"
        if normalized.endswith("/api/paas/v4"):
            return f"{normalized}/chat/completions"
        return f"{normalized}/v1/chat/completions"

    def _call_openai_compatible_chat(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        system_instruction: str,
        request: AgentRunRequest,
        schema: dict[str, Any],
        variables: dict[str, Any],
        max_output_tokens: int,
    ) -> dict[str, Any]:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_instruction},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "taskType": request.task_type,
                            "platform": request.platform,
                            "input": request.input,
                            "context": request.context,
                            "options": self._safe_options_for_model(request.options),
                            "schema": schema,
                            "variables": variables,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "temperature": 0.4,
            "max_tokens": max_output_tokens,
            "response_format": {"type": "json_object"},
        }

        last_error: Exception | None = None
        max_attempts = max(1, self.settings.model_request_max_attempts)
        timeout_seconds = max(5, self.settings.model_request_timeout_seconds)
        for attempt in range(max_attempts):
            try:
                response = httpx.post(
                    self._chat_completions_url(base_url),
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=timeout_seconds,
                    trust_env=False,
                )
                if response.status_code in {429, 500, 502, 503, 504} and attempt < max_attempts - 1:
                    time.sleep(1 + attempt)
                    continue
                response.raise_for_status()
                data = response.json()
                break
            except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError, httpx.TimeoutException) as exc:
                last_error = exc
                if attempt < max_attempts - 1:
                    time.sleep(1 + attempt)
                    continue
                raise
            except httpx.HTTPStatusError as exc:
                last_error = exc
                raise
        else:
            raise last_error or RuntimeError("模型服务调用失败。")

        if not isinstance(data, dict):
            raise ValueError("模型返回的响应不是 JSON 对象。")
        return data

    def _safe_options_for_model(self, options: dict[str, Any]) -> dict[str, Any]:
        safe = dict(options or {})
        debug_auth = safe.pop("debugAuth", None)
        if isinstance(debug_auth, dict):
            public_debug_auth = {
                key: value
                for key, value in debug_auth.items()
                if key in {"webSearchProvider", "modelName", "googleModel", "geminiModel"}
            }
            if public_debug_auth:
                safe["debugAuth"] = public_debug_auth
        return safe

    def _extract_message_content(self, response: dict[str, Any]) -> str:
        choices = response.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("模型响应缺少 choices。")
        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise ValueError("模型响应 choices[0] 格式不正确。")
        message = first_choice.get("message")
        if not isinstance(message, dict):
            raise ValueError("模型响应缺少 message。")
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        raise ValueError("模型响应 message.content 为空。")

    def _parse_json_content(self, content: str) -> dict[str, Any]:
        parsed = self._loads_json_object(content)
        if parsed is not None:
            return parsed

        stripped = content.strip()
        if stripped.startswith("```"):
            lines = stripped.splitlines()
            if len(lines) >= 3:
                candidate = "\n".join(lines[1:-1]).strip()
                parsed = self._loads_json_object(candidate)
                if parsed is not None:
                    return parsed

        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidate = stripped[start : end + 1]
            parsed = self._loads_json_object(candidate)
            if parsed is not None:
                return parsed

        raise ValueError("模型未返回可解析的 JSON 内容。")

    def _loads_json_object(self, content: str) -> dict[str, Any] | None:
        for candidate in (content, self._escape_invalid_json_backslashes(content)):
            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue
        return None

    def _escape_invalid_json_backslashes(self, content: str) -> str:
        result: list[str] = []
        index = 0
        valid_escapes = {'"', "\\", "/", "b", "f", "n", "r", "t", "u"}
        while index < len(content):
            char = content[index]
            if char == "\\" and (index + 1 >= len(content) or content[index + 1] not in valid_escapes):
                result.append("\\\\")
            else:
                result.append(char)
            index += 1
        return "".join(result)

    def _default_save_payload(self, request: AgentRunRequest, data: dict[str, Any]) -> dict[str, Any]:
        type_map = {
            "persona.analyze": ("persona_result", "persona_results"),
            "trend.track": ("trend_tracking_result", "trend_tracking_results"),
            "content.draft": ("content_draft", "content_drafts"),
            "content.revise": ("content_revision", "content_drafts"),
            "general.chat": ("general_chat_turn", "agent_conversations"),
        }
        payload_type, collection = type_map.get(request.task_type, ("agent_result", "agent_results"))
        return {"type": payload_type, "suggestedCollection": collection, "data": data}

    def _normalize_save_payload(
        self,
        request: AgentRunRequest,
        save_payload: dict[str, Any],
        data: dict[str, Any],
    ) -> dict[str, Any]:
        normalized = dict(save_payload)
        default_payload = self._default_save_payload(request, data)
        normalized["type"] = normalized.get("type") or default_payload["type"]
        normalized["suggestedCollection"] = (
            normalized.get("suggestedCollection")
            or normalized.get("suggested_collection")
            or default_payload["suggestedCollection"]
        )
        if not isinstance(normalized.get("data"), dict):
            normalized["data"] = default_payload["data"]
        return normalized
