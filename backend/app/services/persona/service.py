from ...adapters.agent.client import AgentClient
from ...adapters.agent.builder import ContextBuilder
from ...adapters.agent.options import build_agent_options
from ...schemas.agent.protocol import AgentRunRequest
from ...database.crud.persona_crud import PersonaCRUD
from ...database.crud.memory_crud import MemoryCRUD
from ...services.memory import RollingMemoryService
from ...services.agent_debug import build_agent_debug_payload, build_agent_option_overrides
from typing import Any, Dict
import re
from pymongo.errors import PyMongoError


class PersonaService:
    def __init__(self, db=None):
        self.client = AgentClient()
        self.builder = ContextBuilder(db)
        self.persona_crud = PersonaCRUD()
        self.memory_crud = MemoryCRUD()
        self.memory_service = RollingMemoryService()

    async def analyze(
        self,
        user_id: str,
        basic_info: dict,
        persist: bool = True,
        agent_debug: dict | None = None,
        prompt_override: str = None,
    ) -> dict:
        if not basic_info or not any(basic_info.values()):
            return {"status": "failed", "message": "basicInfo不能为空，至少提供一项信息"}

        context = await self.builder.build_persona_analyze_context(user_id)
        agent_base_info = self._build_initial_structured_base_info(basic_info)
        request = AgentRunRequest(
            requestId="req_persona_analyze",
            taskType="persona.analyze",
            platform="xiaohongshu",
            userId=user_id,
            input={
                "baseInfo": agent_base_info,
                "originalBaseInfo": basic_info,
            },
            context=context,
            options=build_agent_options(
                enableTools=False,
                forceStructuredPersona=True,
                promptOverride=prompt_override,
                **build_agent_option_overrides(agent_debug),
            ),
        )
        response = await self.client.run(request)
        if response.status == "failed":
            return {
                "status": "failed",
                "message": (response.error or {}).get("message", "Agent 调用失败"),
                "debug": build_agent_debug_payload(response, agent_debug),
            }

        self._normalize_persona_payload(response.data)
        self._normalize_persona_save_payload(response.savePayload)
        self._annotate_analyze_result(response.data)
        if persist:
            self._persist_persona_save_payload(user_id, response.savePayload)

        persona_data = response.data if isinstance(response.data, dict) else {}
        if isinstance(persona_data, dict):
            persona_data["basicInfo"] = basic_info
        return {
            "data": persona_data,
            "warnings": response.warnings or [],
            "debug": build_agent_debug_payload(response, agent_debug),
        }

    def save_persona(self, user_id: str, persona_data: dict, collection_name: str = "personas") -> dict:
        if not isinstance(persona_data, dict) or not persona_data:
            return {"status": "failed", "message": "persona 数据不能为空"}

        self._normalize_persona_payload(persona_data)
        try:
            saved_record = self.persona_crud.save_persona(user_id, persona_data, collection_name=collection_name)
        except PyMongoError:
            return {"status": "success", "data": persona_data, "warning": "persona 持久化失败"}
        return {"status": "success", "data": persona_data, "record": saved_record}

    def _persist_persona_save_payload(self, user_id: str, save_payload: Any) -> None:
        if not isinstance(save_payload, dict):
            return
        payload_data = save_payload.get("data")
        if not isinstance(payload_data, dict):
            return

        collection_name = save_payload.get("suggestedCollection") or "persona_results"
        self.persona_crud.save_persona(user_id, payload_data, collection_name=collection_name)

    def get_saved_persona(self, user_id: str) -> dict:
        existing = self.persona_crud.get_persona(user_id)
        return existing or {}

    def get_persona_history(self, user_id: str) -> list[dict]:
        return self.persona_crud.get_persona_history(user_id)

    def get_favorite_personas(self, user_id: str) -> list[dict]:
        return self.persona_crud.get_favorite_personas(user_id)

    def get_persona_record(self, user_id: str, record_id: str) -> dict:
        return self.persona_crud.get_persona_record(user_id, record_id) or {}

    def set_persona_favorite(self, user_id: str, record_id: str, is_favorited: bool) -> dict:
        return self.persona_crud.set_persona_favorite(user_id, record_id, is_favorited) or {}

    def delete_persona_record(self, user_id: str, record_id: str) -> bool:
        deleted = self.persona_crud.delete_persona_record(user_id, record_id)
        if deleted:
            try:
                self.memory_crud.delete_agent_chat_conversations_by_persona_record(user_id, record_id)
            except Exception:
                pass
        return deleted

    async def follow_up(
        self,
        user_id: str,
        basic_info: dict,
        user_message: str,
        conversation_history: list = None,
        prompt_override: str = None,
        agent_debug: dict | None = None,
        conversation_scope_id: str | None = None,
    ) -> dict:
        if not user_message:
            return {"status": "failed", "message": "userMessage不能为空"}
        if not basic_info:
            return {"status": "failed", "message": "basicInfo不能为空"}

        # 构建对话历史
        conversation_history = conversation_history or []

        if conversation_scope_id:
            try:
                context = await self.builder.build_persona_follow_up_context(
                    user_id,
                    basic_info,
                    conversation_history,
                    conversation_scope_id=conversation_scope_id,
                )
            except TypeError:
                context = await self.builder.build_persona_follow_up_context(
                    user_id,
                    basic_info,
                    conversation_history,
                )
        else:
            context = await self.builder.build_persona_follow_up_context(
                user_id,
                basic_info,
                conversation_history,
            )
        request = AgentRunRequest(
            requestId="req_persona_follow_up",
            taskType="persona.follow_up",
            platform="xiaohongshu",
            userId=user_id,
            input={"userMessage": user_message},
            context=context,
            options=build_agent_options(
                promptOverride=prompt_override,
                **build_agent_option_overrides(agent_debug),
            ),
        )
        response = await self.client.run(request)
        if response.status == "failed":
            return {
                "status": "failed",
                "message": (response.error or {}).get("message", "Agent 调用失败"),
                "debug": build_agent_debug_payload(response, agent_debug),
            }

        self._normalize_persona_payload(response.data)
        self._normalize_persona_save_payload(response.savePayload)
        self._annotate_follow_up_result(response.data, user_message)
        persona_data = response.data if isinstance(response.data, dict) else {}
        next_memory_state = await self.memory_service.refresh_state(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="persona",
            raw_history=conversation_history,
            current_artifact=persona_data.get("personaDraft") if isinstance(persona_data, dict) else None,
        )
        if isinstance(persona_data, dict):
            persona_data["basicInfo"] = basic_info
            persona_data["conversationSummary"] = next_memory_state.get("conversationSummary")
            persona_data["memoryMeta"] = next_memory_state.get("memoryMeta")
        return {
            "data": persona_data,
            "warnings": response.warnings or [],
            "debug": build_agent_debug_payload(response, agent_debug),
        }

    def _annotate_analyze_result(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        payload["discussionOnly"] = False
        payload["structuredResult"] = {
            key: value
            for key, value in payload.items()
            if key in {"persona", "niche", "audience", "contentStyle", "referenceCreatorDirections", "followUpQuestions"}
        }

    def _annotate_follow_up_result(self, payload: Any, user_message: str) -> None:
        if not isinstance(payload, dict):
            return
        structured = self._should_expose_structured_persona(payload, user_message)
        payload["discussionOnly"] = not structured
        payload["structuredResult"] = payload.get("personaDraft") if structured and isinstance(payload.get("personaDraft"), dict) else None

    def _normalize_persona_save_payload(self, save_payload: Any) -> None:
        if not isinstance(save_payload, dict):
            return
        payload_data = save_payload.get("data")
        if isinstance(payload_data, dict):
            self._normalize_persona_payload(payload_data)

    def _normalize_persona_payload(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return

        if "followUpQuestions" in payload:
            payload["followUpQuestions"] = self._limit_question_list(payload.get("followUpQuestions"))
        if "nextQuestions" in payload:
            payload["nextQuestions"] = self._limit_question_list(payload.get("nextQuestions"))

        persona = payload.get("persona")
        if isinstance(persona, dict):
            normalized_name = self._normalize_persona_name(persona.get("name"))
            if normalized_name:
                persona["name"] = normalized_name

        persona_draft = payload.get("personaDraft")
        if isinstance(persona_draft, dict):
            draft_persona = persona_draft.get("persona")
            if isinstance(draft_persona, dict):
                normalized_name = self._normalize_persona_name(draft_persona.get("name"))
                if normalized_name:
                    draft_persona["name"] = normalized_name

        self._ensure_persona_card_preview(payload)

    def _limit_question_list(self, value: Any, max_items: int = 3) -> list[str]:
        if not isinstance(value, list):
            return []

        questions: list[str] = []
        for item in value:
            question = str(item or "").strip() if item is not None else ""
            if question and question not in questions:
                questions.append(question)
            if len(questions) >= max_items:
                break
        return questions

    def _normalize_persona_name(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""

        text = re.sub(r"\s+", "", value).strip()
        if not text:
            return ""

        original = text
        text = re.sub(r"^(我是|我想做|适合做|建议你做)", "", text)
        text = re.sub(r"^(一个|一名|一位)", "", text)
        text = re.split(r"[。.!?！？；;：:（）()]", text, maxsplit=1)[0].strip()
        text = re.split(r"(，|,)", text, maxsplit=1)[0].strip()
        text = re.sub(r"(顶流|爆款|全能|高端)", "", text)
        text = re.sub(r"(分享账号|账号)$", "", text)
        text = text.strip("“”\"' ")

        if len(text) > 12:
            text = self._truncate_persona_name(text)

        if len(text) < 4:
            fallback = self._truncate_persona_name(original)
            return fallback if len(fallback) >= 4 else original[:12]
        return text

    def _build_initial_structured_base_info(self, basic_info: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(basic_info or {})
        force_hint = (
            "这是人设打造初始页的首条业务输入。"
            "请基于用户已提交的信息直接生成一版可展示、可保存的结构化初版人设，不要只输出追问。"
            "结果覆盖 persona、niche、audience、contentStyle、referenceCreatorDirections 和 followUpQuestions。"
            "表达重点放在真实身份、可持续图文方向和下一篇可以怎么写，少用运营报告口吻。"
            "followUpQuestions 只给 2-3 个可选补充问题，优先问偏好、不喜欢的风格和可拍素材；只放字段里。"
        )
        existing_goals = normalized.get("goals")
        goal_list = [item for item in existing_goals if isinstance(item, str) and item.strip()] if isinstance(existing_goals, list) else []
        normalized["goals"] = [force_hint, *goal_list]
        return normalized

    def _truncate_persona_name(self, text: str) -> str:
        if len(text) <= 12:
            return text

        for token in ("博主", "达人", "玩家", "顾问", "教练", "搭子", "系", "向", "型"):
            index = text.find(token)
            if 3 <= index + len(token) <= 12:
                return text[: index + len(token)]
        return text[:12]

    def _ensure_persona_card_preview(self, payload: Dict[str, Any]) -> None:
        target = payload.get("personaDraft") if isinstance(payload.get("personaDraft"), dict) else payload
        if not isinstance(target, dict):
            return

        persona = target.get("persona") if isinstance(target.get("persona"), dict) else {}
        content_style = target.get("contentStyle") if isinstance(target.get("contentStyle"), list) else []
        card_preview = target.get("cardPreview") if isinstance(target.get("cardPreview"), dict) else {}

        persona_label = self._normalize_card_preview_field(
            card_preview.get("personaLabel"),
            fallback=self._normalize_persona_name(persona.get("name")) or "内容定位",
        )
        base_profile = self._normalize_card_preview_field(
            card_preview.get("baseProfile"),
            fallback=self._build_card_preview_base_profile(target),
            preserve_separator=True,
        )
        keywords_label = self._normalize_card_preview_field(
            card_preview.get("keywordsLabel"),
            fallback=self._build_card_preview_keywords(target),
            preserve_separator=True,
        )
        audience_label = self._normalize_card_preview_field(
            card_preview.get("audienceLabel") or card_preview.get("interestLabel"),
            fallback=self._build_card_preview_audience(target),
            audience_mode=True,
        )
        tone_label = self._normalize_card_preview_field(
            card_preview.get("toneLabel"),
            fallback=self._build_card_preview_tone(content_style),
        )

        target["cardPreview"] = {
            "personaLabel": persona_label,
            "baseProfile": base_profile,
            "keywordsLabel": keywords_label,
            "audienceLabel": audience_label,
            "toneLabel": tone_label,
        }

    def _normalize_card_preview_field(
        self,
        value: Any,
        fallback: str,
        preserve_separator: bool = False,
        audience_mode: bool = False,
    ) -> str:
        text = str(value or "").strip() if value is not None else ""
        text = re.sub(r"\s+", "", text)
        text = re.sub(r"^(人设定位|基础画像|关键词|兴趣方向|目标受众|内容语气)[:：]", "", text)
        text = re.split(r"[。.!?！？；;：:（）()]", text, maxsplit=1)[0]
        if audience_mode:
            text = self._compress_audience_preview(text)
        if re.search(r"[、·/|]", text):
            term_chars = 5 if preserve_separator else 4
            terms = [term[:term_chars] for term in re.split(r"[、，,·/|]", text) if term]
            text = " · ".join(terms[:3 if preserve_separator else 2])
        else:
            text = re.split(r"[，,]", text, maxsplit=1)[0]
        text = re.sub(r"[。.!?！？；;：:（）()]", "", text)
        text = re.sub(r"[、，,]", " · ", text)
        text = re.sub(r"(分享账号|账号|博主|达人|主理人|记录者|分享者|创作者)$", "", text)
        if not text:
            text = fallback.strip()
        chars = list(text)
        max_chars = 16 if preserve_separator else 14 if audience_mode else 14
        if len(chars) > max_chars:
            text = "".join(chars[:max_chars])
        return text or fallback

    def _build_card_preview_keywords(self, target: Dict[str, Any]) -> str:
        niche = target.get("niche") if isinstance(target.get("niche"), dict) else {}
        primary = str(niche.get("primary") or "").strip()
        secondary = [
            str(item).strip()
            for item in niche.get("secondary", [])
            if isinstance(item, str) and item.strip()
        ] if isinstance(niche.get("secondary"), list) else []
        parts = [item for item in [primary, *secondary[:1]] if item]
        return self._join_preview_terms(parts, max_items=2)

    def _build_card_preview_base_profile(self, target: Dict[str, Any]) -> str:
        basic_info = target.get("basicInfo") if isinstance(target.get("basicInfo"), dict) else {}
        gender = str(basic_info.get("gender") or "").strip()
        age = str(basic_info.get("age") or "").strip()
        occupation = str(basic_info.get("occupation") or "").strip()
        age_text = f"{age}岁" if age else ""
        occupation = occupation[:4] if occupation else ""
        parts = [item for item in [gender, age_text, occupation] if item]
        return self._join_preview_terms(parts, max_items=3) or "账号画像"

    def _build_card_preview_audience(self, target: Dict[str, Any]) -> str:
        audience = target.get("audience") if isinstance(target.get("audience"), list) else []
        parts = [str(item).strip() for item in audience if isinstance(item, str) and item.strip()]
        return self._join_preview_terms(parts, max_items=1, audience_mode=True) or "目标受众"

    def _build_card_preview_tone(self, content_style: list[Any]) -> str:
        parts = [str(item).strip() for item in content_style if isinstance(item, str) and item.strip()]
        return self._join_preview_terms(parts, max_items=2) or "真实自然"

    def _join_preview_terms(self, parts: list[str], max_items: int = 3, audience_mode: bool = False) -> str:
        unique: list[str] = []
        for part in parts:
            cleaned = re.sub(r"\s+", "", part)
            cleaned = re.sub(r"[，,。.!?！？；;：:（）()]", "", cleaned)
            cleaned = re.sub(r"(分享账号|账号|博主|达人|主理人|记录者|分享者|创作者|的同龄人|初学者|新手)$", "", cleaned)
            if audience_mode:
                cleaned = self._compress_audience_preview(cleaned)
            max_term_chars = 12 if audience_mode else 6
            if len(cleaned) > max_term_chars:
                cleaned = cleaned[:max_term_chars]
            if cleaned and cleaned not in unique:
                unique.append(cleaned)
            if len(unique) >= max_items:
                break
        return " · ".join(unique)

    def _compress_audience_preview(self, text: str) -> str:
        if not text:
            return ""
        candidates = (
            "校园跑步爱好者",
            "跑步健身新手",
            "跑步年轻人",
            "年轻人",
            "大学生",
            "女生",
            "男生",
            "新手",
            "宝妈",
            "职场人",
            "上班族",
            "跑者",
            "学生",
            "同龄人",
        )
        for candidate in candidates:
            if candidate in text:
                return candidate
        text = re.sub(r"^(对|想|喜欢|关注|正在|准备|希望|需要).*(的)", "", text)
        text = re.sub(r"(感兴趣|有兴趣|想提升|想学习|想入门|准备入门|正在入门|人群|用户|受众)$", "", text)
        return text

    def _should_expose_structured_persona(self, payload: Dict[str, Any], user_message: str) -> bool:
        draft = payload.get("personaDraft")
        if not isinstance(draft, dict):
            return False

        has_meaningful_draft = self._has_meaningful_persona_draft(draft)
        if not has_meaningful_draft:
            return False

        explicit_structured_intent = self._has_explicit_structured_intent(user_message)
        if explicit_structured_intent:
            return True

        reply = str(payload.get("reply") or "").strip()
        next_questions = payload.get("nextQuestions")
        has_next_questions = isinstance(next_questions, list) and any(
            isinstance(item, str) and item.strip() for item in next_questions
        )
        if self._reply_indicates_more_info_needed(reply) or has_next_questions:
            return False

        ready_to_save = bool(payload.get("isReadyToSave"))
        if ready_to_save:
            return True

        return True

    def _has_complete_persona_draft(self, draft: Dict[str, Any]) -> bool:
        persona = draft.get("persona")
        niche = draft.get("niche")
        audience = draft.get("audience")
        content_style = draft.get("contentStyle")

        has_persona = isinstance(persona, dict) and any(
            str(persona.get(key) or "").strip()
            for key in ("name", "description", "positioning", "personaPosition")
        )
        has_niche = isinstance(niche, dict) and any(
            (isinstance(value, str) and value.strip())
            or (isinstance(value, list) and any(isinstance(item, str) and item.strip() for item in value))
            for value in niche.values()
        )
        has_audience = isinstance(audience, list) and any(isinstance(item, str) and item.strip() for item in audience)
        has_content_style = isinstance(content_style, list) and any(
            isinstance(item, str) and item.strip() for item in content_style
        )
        return has_persona and has_niche and has_audience and has_content_style

    def _has_explicit_structured_intent(self, user_message: str) -> bool:
        text = re.sub(r"\s+", "", str(user_message or ""))
        if not text:
            return False
        patterns = (
            r"重新整理一版",
            r"更新一版人设",
            r"更新一版",
            r"给我一版新的人设",
            r"给我最终版",
            r"输出完整人设",
            r"完整人设",
            r"完整输出",
            r"输出一版",
            r"人设草案",
            r"完整草案",
            r"生成草案",
            r"整理草案",
            r"定稿",
            r"保存",
            r"就按这个来",
            r"最终版",
        )
        return any(re.search(pattern, text) for pattern in patterns)

    def _reply_indicates_more_info_needed(self, reply: str) -> bool:
        if not reply:
            return False
        patterns = (
            r"还需要了解",
            r"还需要确认",
            r"还想了解",
            r"还要了解",
            r"还要确认",
            r"为了更好地帮你",
            r"接下来.*了解",
            r"先确认",
            r"继续补充",
            r"继续完善",
            r"继续追问",
            r"下一步",
            r"再补充",
            r"还可以补充",
        )
        return any(re.search(pattern, reply) for pattern in patterns)

    def _has_meaningful_persona_draft(self, draft: Dict[str, Any]) -> bool:
        persona = draft.get("persona")
        niche = draft.get("niche")
        audience = draft.get("audience")
        content_style = draft.get("contentStyle")
        return bool(
            (isinstance(persona, dict) and any(str(value).strip() for value in persona.values() if isinstance(value, str)))
            or (isinstance(niche, dict) and any(
                (isinstance(value, str) and value.strip())
                or (isinstance(value, list) and any(isinstance(item, str) and item.strip() for item in value))
                for value in niche.values()
            ))
            or (isinstance(audience, list) and any(isinstance(item, str) and item.strip() for item in audience))
            or (isinstance(content_style, list) and any(isinstance(item, str) and item.strip() for item in content_style))
        )

    def _strip_terminal_punctuation(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return re.sub(r"[。.!?！？；;，,\s]+$", "", value.strip())

    def _format_sentence_line(self, label: str, value: Any) -> str:
        text = self._strip_terminal_punctuation(value)
        return f"{label}{text}。" if text else ""

    def _normalize_join_segment(self, value: Any, strip_sentence_end: bool = False) -> str:
        if not isinstance(value, str):
            return ""
        cleaned = re.sub(r"\s+", " ", value).strip()
        if not cleaned:
            return ""
        cleaned = self._strip_terminal_punctuation(cleaned) if strip_sentence_end else re.sub(r"[，,、；;：:\s]+$", "", cleaned).strip()
        return cleaned

    def _normalize_join_segments(self, values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        parts: list[str] = []
        for item in values:
            normalized = self._normalize_join_segment(item, strip_sentence_end=True)
            if normalized:
                parts.append(normalized)
        return parts

    def _format_persona_text(self, data: Dict[str, Any]) -> str:
        persona = data.get("persona") or {}
        name = persona.get("name")
        description = persona.get("description")
        niche = data.get("niche") or {}
        audience = data.get("audience") or []
        content_style = data.get("contentStyle") or []
        follow_up = data.get("followUpQuestions") or []

        lines = []
        if name:
            line = self._format_sentence_line("推荐人设：", name)
            if line:
                lines.append(line)
        if description:
            line = self._format_sentence_line("人设描述：", description)
            if line:
                lines.append(line)

        niche_parts = []
        if niche.get("primary"):
            normalized_primary = self._normalize_join_segment(niche["primary"], strip_sentence_end=True)
            if normalized_primary:
                niche_parts.append(normalized_primary)
        if niche.get("secondary"):
            niche_parts.extend(self._normalize_join_segments(niche.get("secondary", [])))
        if niche_parts:
            line = self._format_sentence_line("擅长领域：", "、".join(niche_parts))
            if line:
                lines.append(line)

        if audience:
            line = self._format_sentence_line("目标受众：", "、".join(self._normalize_join_segments(audience)))
            if line:
                lines.append(line)

        if content_style:
            line = self._format_sentence_line("内容风格：", "、".join(self._normalize_join_segments(content_style)))
            if line:
                lines.append(line)

        if follow_up:
            follow_lines = "；".join(self._normalize_join_segments(follow_up))
            line = self._format_sentence_line("后续可继续回答的问题：", follow_lines)
            if line:
                lines.append(line)

        return "".join(lines) if lines else "暂无人设分析结果。"
