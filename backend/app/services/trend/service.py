from ...adapters.agent.client import AgentClient
from ...adapters.agent.builder import ContextBuilder
from ...adapters.agent.options import build_agent_options
from ...schemas.agent.protocol import AgentRunRequest
from ...database.crud.persona_crud import PersonaCRUD
from ...database.crud.trend_crud import TrendCRUD
from ...services.memory import RollingMemoryService
from ...services.agent_debug import build_agent_debug_payload, build_agent_option_overrides
from typing import Any, Dict
import re


class TrendService:
    def __init__(self, db=None):
        self.client = AgentClient()
        self.builder = ContextBuilder(db)
        self.trend_crud = TrendCRUD()
        self.persona_crud = PersonaCRUD()
        self.memory_service = RollingMemoryService()

    async def track(
        self,
        user_id: str,
        preference: str,
        persona: dict = None,
        conversation_history: list = None,
        summary_source_conversation: list = None,
        summary_mode: str | None = None,
        prompt_override: str = None,
        agent_debug: dict | None = None,
        conversation_scope_id: str | None = None,
    ) -> dict:
        if not persona and not await self._has_saved_persona(user_id):
            return {"status": "failed", "message": "热门追踪需要先保存人设信息，请先进行人设分析"}

        if self._is_non_substantive_input(preference):
            return {
                "data": {
                    "discussionOnly": True,
                    "completeAnalysis": None,
                    "text": "我在，刚才这句还不足以判断你是想继续聊天，还是想让我正式做热点/趋势/选题追踪。你可以直接说你的目标，比如“聊聊这个方向适不适合我”，或者“给我做一版大学生成长赛道的热点选题”。",
                    "raw": {
                        "reply": "我在，刚才这句还不足以判断你是想继续聊天，还是想让我正式做热点/趋势/选题追踪。你可以直接说你的目标，比如“聊聊这个方向适不适合我”，或者“给我做一版大学生成长赛道的热点选题”。",
                        "isReadyToSave": False,
                        "trendSummary": {},
                        "hotTrends": [],
                        "audienceNeeds": [],
                        "topicOpportunities": [],
                        "validationKeywords": [],
                    },
                },
                "warnings": [],
            }

        is_initial_page_first_turn = self._is_initial_page_first_turn(conversation_history)
        current_artifact = self._read_current_artifact_from_history(conversation_history)
        if conversation_scope_id or current_artifact:
            try:
                context = await self.builder.build_trend_track_context(
                    user_id,
                    persona,
                    conversation_history,
                    summary_source_conversation,
                    conversation_scope_id=conversation_scope_id,
                    current_artifact=current_artifact,
                )
            except TypeError:
                context = await self.builder.build_trend_track_context(
                    user_id,
                    persona,
                    conversation_history,
                    summary_source_conversation,
                )
        else:
            context = await self.builder.build_trend_track_context(
                user_id,
                persona,
                conversation_history,
                summary_source_conversation,
            )
        force_structured_report = self._should_force_structured_report(
            preference,
            conversation_history,
            summary_mode=summary_mode,
        )
        agent_preference = (
            self._build_realtime_progress_summary_preference(summary_source_conversation, preference)
            if summary_mode == "realtime_progress"
            else
            self._build_initial_structured_preference(preference)
            if is_initial_page_first_turn
            else preference
        )
        request = AgentRunRequest(
            requestId="req_trend_track",
            taskType="trend.track",
            platform="xiaohongshu",
            userId=user_id,
            input={
                "userPreference": agent_preference,
                "originalUserPreference": preference,
            },
            context=context,
            options=build_agent_options(
                forceStructuredReport=force_structured_report,
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

        response_data = dict(response.data or {})
        response_data.setdefault("originalUserPreference", preference)
        complete_analysis = self._build_complete_analysis(response_data)
        next_memory_state = await self.memory_service.refresh_state(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="trend",
            raw_history=conversation_history,
            current_artifact=complete_analysis,
            force=summary_mode == "realtime_progress",
        )
        return {
            "data": {
                "discussionOnly": complete_analysis is None,
                "completeAnalysis": complete_analysis,
                "text": self._format_trend_text(response_data),
                "raw": response_data,
                "conversationSummary": next_memory_state.get("conversationSummary"),
                "memoryMeta": next_memory_state.get("memoryMeta"),
            },
            "warnings": response.warnings or [],
            "debug": build_agent_debug_payload(response, agent_debug),
        }

    def _build_complete_analysis(self, data: Dict[str, Any]) -> Dict[str, Any] | None:
        summary = data.get("trendSummary", {}) or {}
        if isinstance(summary, str):
            summary = {"summary": summary}

        hot_trends = data.get("hotTrends", []) or []
        trend_parts = []
        for item in hot_trends:
            name = self._sanitize_trend_copy(item.get("name"))
            reason = self._sanitize_trend_copy(item.get("reason"))
            if name and reason:
                trend_parts.append(f"{name}：{self._tighten_trend_copy(reason)}")
            elif name:
                trend_parts.append(name)
        trends_text = "；".join(trend_parts)
        if not trends_text:
            trends_text = self._tighten_trend_copy(self._sanitize_trend_copy((summary.get("summary") or "").strip()))

        audience_needs = data.get("audienceNeeds", []) or []
        audience_parts = []
        for item in audience_needs:
            need = self._sanitize_trend_copy(item.get("need"))
            evidence = self._sanitize_trend_copy(item.get("evidence"))
            if need and evidence:
                audience_parts.append(f"{need}：{self._tighten_trend_copy(evidence)}")
            elif need:
                audience_parts.append(need)
        audience_text = "；".join(audience_parts)

        topics = [
            t.get("title")
            for t in (data.get("topicOpportunities", []) or [])
            if isinstance(t, dict) and t.get("title")
        ]
        topics = self._complete_topic_titles(data, hot_trends, audience_needs, topics)
        card_preview = self._build_card_preview(data, hot_trends, topics)

        complete_analysis = {
            "trackName": self._build_track_name(data, summary, hot_trends, audience_needs, topics),
            "trends": trends_text or "暂无趋势分析。",
            "audience": audience_text or "暂无受众需求洞察。",
            "topics": topics[:3],
            "cardPreview": card_preview,
        }
        return complete_analysis if self._is_complete_analysis(complete_analysis) else None

    def _build_track_name(
        self,
        data: Dict[str, Any],
        summary: Dict[str, Any],
        hot_trends: list,
        audience_needs: list,
        topics: list[str],
    ) -> str:
        generic = {"智能趋势分析", "热门趋势", "趋势分析", "热门追踪", "小红书", "涨粉赛道"}
        candidates: list[Any] = [
            data.get("originalUserPreference"),
            summary.get("niche") if isinstance(summary, dict) else "",
            *(data.get("validationKeywords") or []),
            *(item.get("name") for item in hot_trends if isinstance(item, dict)),
            *(item.get("need") for item in audience_needs if isinstance(item, dict)),
            *topics,
        ]
        for candidate in candidates:
            phrase = self._short_preview_phrase(candidate)
            if phrase and phrase not in generic:
                return phrase
        return "热门追踪"

    def _complete_topic_titles(
        self,
        data: Dict[str, Any],
        hot_trends: list,
        audience_needs: list,
        topics: list[str],
    ) -> list[str]:
        completed = []
        for topic in topics:
            cleaned = self._sanitize_trend_copy(topic)
            if cleaned and cleaned not in completed:
                completed.append(cleaned)

        summary = data.get("trendSummary", {}) or {}
        niche = self._sanitize_trend_copy(summary.get("niche") if isinstance(summary, dict) else "")
        candidates = []
        candidates.extend(item.get("name") for item in hot_trends if isinstance(item, dict))
        candidates.extend(item.get("need") for item in audience_needs if isinstance(item, dict))
        candidates.extend(data.get("validationKeywords") or [])
        if niche:
            candidates.append(niche)

        stems = [self._short_preview_phrase(candidate) for candidate in candidates]
        if niche:
            stems.append(self._short_preview_phrase(niche))
        stems = [stem for stem in stems if stem]

        templates = [
            "{}新手先看这篇",
            "{}真实避坑清单",
            "{}怎么开始更稳",
            "{}经验分享",
        ]
        for stem in stems:
            for template in templates:
                title = self._limit_topic_title(template.format(stem))
                if title and title not in completed:
                    completed.append(title)
                if len(completed) >= 3:
                    return completed[:3]

        fallback_stem = self._short_preview_phrase(niche) or "这个方向"
        for title in [
            f"{fallback_stem}新手先看",
            f"{fallback_stem}避坑清单",
            f"{fallback_stem}经验分享",
        ]:
            title = self._limit_topic_title(title)
            if title and title not in completed:
                completed.append(title)
            if len(completed) >= 3:
                break
        return completed[:3]

    def _limit_topic_title(self, title: Any) -> str:
        cleaned = self._sanitize_trend_copy(title)
        return cleaned[:20].strip()

    def _is_complete_analysis(self, payload: Dict[str, Any]) -> bool:
        track_name = self._sanitize_trend_copy(payload.get("trackName"))
        trends = self._sanitize_trend_copy(payload.get("trends"))
        audience = self._sanitize_trend_copy(payload.get("audience"))
        topics = payload.get("topics") or []
        valid_topics = [topic for topic in topics if isinstance(topic, str) and topic.strip()]
        return bool(track_name and trends and audience and len(valid_topics) >= 3)

    def _build_card_preview(self, data: Dict[str, Any], hot_trends: list, topics: list[str]) -> Dict[str, list[str]]:
        raw_preview = data.get("cardPreview") if isinstance(data.get("cardPreview"), dict) else {}
        discovery_keywords = self._normalize_preview_terms(raw_preview.get("discoveryKeywords") if raw_preview else [])
        short_topics = self._normalize_preview_terms(raw_preview.get("shortTopics") if raw_preview else [])

        if len(discovery_keywords) < 2:
            trend_names = [
                self._short_preview_phrase(item.get("name"))
                for item in hot_trends
                if isinstance(item, dict)
            ]
            discovery_keywords = self._merge_preview_terms(discovery_keywords, trend_names)

        if len(discovery_keywords) < 2:
            summary = data.get("trendSummary", {}) or {}
            summary_text = summary if isinstance(summary, str) else summary.get("summary")
            discovery_keywords = self._merge_preview_terms(discovery_keywords, self._split_preview_text(summary_text))

        if len(short_topics) < 2:
            short_topics = self._merge_preview_terms(short_topics, [self._short_preview_phrase(topic) for topic in topics])

        if len(short_topics) < 2:
            short_topics = self._merge_preview_terms(short_topics, discovery_keywords)

        return {
            "discoveryKeywords": discovery_keywords[:3],
            "shortTopics": short_topics[:3],
        }

    def _normalize_preview_terms(self, terms: Any) -> list[str]:
        if not isinstance(terms, list):
            return []
        return self._merge_preview_terms([], [self._short_preview_phrase(term) for term in terms])

    def _merge_preview_terms(self, base: list[str], candidates: list[str]) -> list[str]:
        merged = [term for term in base if term]
        for term in candidates:
            if term and term not in merged:
                merged.append(term)
            if len(merged) >= 3:
                break
        return merged

    def _split_preview_text(self, text: Any) -> list[str]:
        cleaned = self._sanitize_trend_copy(text)
        if not cleaned:
            return []
        return [self._short_preview_phrase(item) for item in re.split(r"[、,，；;\n。]+", cleaned)]

    def _short_preview_phrase(self, text: Any) -> str:
        cleaned = self._sanitize_trend_copy(text)
        if not cleaned:
            return ""

        if "通勤妆" in cleaned:
            return "新手通勤妆"
        if "彩妆" in cleaned and ("清单" in cleaned or "平价" in cleaned or "百元" in cleaned):
            return "百元彩妆清单"
        if "底妆" in cleaned and ("坑" in cleaned or "避坑" in cleaned):
            return "底妆避坑"
        if "化妆" in cleaned and ("新手" in cleaned or "第一次" in cleaned):
            return "新手化妆"
        if "考证" in cleaned and ("坑" in cleaned or "避坑" in cleaned):
            return "考证避坑"
        if "考证" in cleaned and ("规划" in cleaned or "计划" in cleaned):
            return "考证规划"
        if "考证" in cleaned and ("表" in cleaned or "时间" in cleaned):
            return "考证时间表"
        if "少踩坑" in cleaned or "避雷" in cleaned:
            return "少踩坑"
        if "自律" in cleaned:
            return "低成本自律" if "低成本" in cleaned else "自律方法"
        if "复习" in cleaned or "期末" in cleaned:
            return "期末复习清单"
        if "早八" in cleaned:
            return "早八出门"
        if "宿舍" in cleaned and ("运动" in cleaned or "健身" in cleaned):
            return "宿舍轻运动"
        if "平价" in cleaned:
            return "平价替代"
        if "低成本" in cleaned:
            return "低成本成长"
        if "时间管理" in cleaned:
            return "时间管理"
        if "成长" in cleaned:
            return "个人成长"
        if "可执行" in cleaned or "马上照做" in cleaned:
            return "可执行方法"
        if "资料" in cleaned:
            return "资料选择"
        if "清单" in cleaned:
            return "收藏清单"

        phrase = re.split(r"[：:；;，,。.!?！？\n]", cleaned, maxsplit=1)[0]
        phrase = re.sub(r"^\d+[.、]\s*", "", phrase)
        phrase = re.sub(r"(大学生|小红书|如何|怎么|教程|方法|最容易|第一次|我用|一张表|这?些|几个|多少|真的)", "", phrase)
        phrase = re.sub(r"\s+", "", phrase)
        if not phrase:
            phrase = re.sub(r"\s+", "", cleaned)
        return phrase[:14]

    async def get_latest_snapshot(self, user_id: str) -> dict:
        latest_snapshot = self.trend_crud.get_latest_trend_snapshot(user_id)
        if not isinstance(latest_snapshot, dict):
            return {}
        return self._normalize_history_record(latest_snapshot)

    async def get_trend_history(self, user_id: str) -> list:
        history = self.trend_crud.get_trend_history(user_id)
        return [self._normalize_history_record(record) for record in history if isinstance(record, dict)]

    def save_trend_record(self, user_id: str, record: Dict[str, Any]) -> dict:
        normalized_record = self._normalize_history_record(record)
        scope_id = normalized_record.get("memoryMeta", {}).get("scopeId") if isinstance(normalized_record.get("memoryMeta"), dict) else None
        if isinstance(scope_id, str) and scope_id:
            memory_state = self.memory_service.load_state(user_id, scope_id)
            normalized_record["conversationSummary"] = normalized_record.get("conversationSummary") or memory_state.get("conversationSummary") or {}
            normalized_record["memoryMeta"] = normalized_record.get("memoryMeta") or memory_state.get("memoryMeta") or {}
        self.trend_crud.save_trend_snapshot(user_id, normalized_record)
        return {"status": "success", "data": normalized_record}

    def _read_current_artifact_from_history(self, conversation_history: list | None) -> Dict[str, Any] | None:
        history = conversation_history or []
        for message in reversed(history):
            if not isinstance(message, dict):
                continue
            analysis = message.get("analysis")
            if isinstance(analysis, dict):
                return analysis
        return None

    def delete_trend_record(self, user_id: str, record: Dict[str, Any]) -> dict:
        success, reason = self.trend_crud.delete_trend_snapshot(user_id, record)
        return {"status": "success" if success else "failed", "data": success, "reason": reason}

    async def _has_saved_persona(self, user_id: str) -> bool:
        return bool(self.persona_crud.get_persona(user_id))

    def _should_force_structured_report(
        self,
        preference: str,
        conversation_history: list = None,
        summary_mode: str | None = None,
    ) -> bool:
        normalized = (preference or "").strip().lower()
        if not normalized:
            return False

        if summary_mode == "realtime_progress":
            return True

        if self._is_non_substantive_input(normalized):
            return False

        if self._is_acknowledgement_only(normalized):
            return False

        if self._is_initial_page_first_turn(conversation_history):
            return True

        if self._is_explanation_request(normalized):
            return False

        explicit_report_keywords = [
            "开始追踪",
            "完整追踪",
            "完整报告",
            "输出报告",
            "生成报告",
            "给我选题",
            "推荐选题",
            "重新追踪",
            "重新生成",
            "重新来一版",
            "换一批选题",
            "再给我选题",
            "再生成",
            "保存这份",
            "保存结果",
            "定稿",
        ]
        if any(keyword in normalized for keyword in explicit_report_keywords):
            return True

        return self._is_analysis_generation_request(normalized)

    def _is_initial_page_first_turn(self, conversation_history: list | None = None) -> bool:
        history = conversation_history or []
        valid_messages = [
            message
            for message in history
            if isinstance(message, dict)
            and message.get("role") in {"user", "assistant"}
            and isinstance(message.get("content"), str)
            and message.get("content", "").strip()
        ]
        if not valid_messages:
            return True
        if any(message.get("role") == "assistant" for message in valid_messages):
            return False
        return len(valid_messages) == 1

    def _build_initial_structured_preference(self, preference: str) -> str:
        raw_input = (preference or "").strip()
        return "\n".join(
            [
                "这是热门追踪初始页的首条业务输入。",
                "身份边界：顶流小猪梨只是 Agent 助手昵称，不是用户的人设、账号名或内容主角；用户的具体人设只以 context.savedPersona 为准。",
                "请把用户原始输入直接理解为本轮要追踪的赛道、方向、偏好或线索，不要先停留在讨论态，也不要只做解释。",
                "请直接输出一版可展示、可保存的结构化热门追踪结果，保留 trendSummary、hotTrends、audienceNeeds、topicOpportunities、validationKeywords 和 cardPreview，并在 topicOpportunities 中稳定给出 3 个能直接转成小红书图文的标题方向。",
                "如果没有真实检索数据，不要伪造热度；请写成保守判断，并给出需要继续验证的关键词。",
                f"用户原始输入：{raw_input}",
            ]
        )

    def _build_realtime_progress_summary_preference(
        self,
        conversation_history: list | None = None,
        fallback_preference: str = "",
    ) -> str:
        history = conversation_history or []
        formatted_history: list[str] = []
        for message in history:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = message.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            cleaned = content.strip()
            if not cleaned:
                continue
            speaker = "用户" if role == "user" else "助手"
            formatted_history.append(f"{speaker}：{cleaned}")

        history_block = "\n".join(formatted_history) if formatted_history else f"用户：{(fallback_preference or '').strip()}"
        return "\n".join(
            [
                "这是热门追踪里的“总结实时进度”专属请求。",
                "身份边界：顶流小猪梨只是 Agent 助手昵称，不是用户的人设、账号名或内容主角；用户的具体人设只以 context.savedPersona 为准。",
                "请基于当前整段聊天记录，总结到目前为止已经明确的热点趋势、受众需求和可执行选题，不要只回答某一句追问。",
                "你必须输出一版可直接用于更新热门追踪概要图和历史卡片的结构化结果，保留 trendSummary、hotTrends、audienceNeeds、topicOpportunities、validationKeywords 和 cardPreview，并在 topicOpportunities 中稳定给出 3 个可转成小红书图文的标题方向。",
                "如果聊天里已经出现过多轮趋势分析，请合并为当前最新的一版总结，不要遗漏已经确认过的重要结论。",
                "当前聊天记录：",
                history_block,
            ]
        )

    def _is_acknowledgement_only(self, text: str) -> bool:
        normalized = re.sub(r"[\s，,。！？!?.~～]+", "", text or "")
        if not normalized:
            return True

        acknowledgement_tokens = {
            "好",
            "好的",
            "好的继续",
            "好的继续吧",
            "明白",
            "明白了",
            "收到",
            "收到啦",
            "了解",
            "了解了",
            "行",
            "行吧",
            "可以",
            "继续",
            "继续吧",
            "嗯",
            "嗯嗯",
            "ok",
            "okay",
            "yes",
        }
        return normalized in acknowledgement_tokens

    def _is_non_substantive_input(self, text: str) -> bool:
        normalized = re.sub(r"[\s，,。！？!?.~～、…]+", "", (text or "").lower())
        if not normalized:
            return True

        non_substantive_tokens = {
            "啊",
            "阿",
            "哦",
            "噢",
            "嗯",
            "嗯嗯",
            "呃",
            "额",
            "哎",
            "诶",
            "欸",
            "哈",
            "哈哈",
            "好",
            "好的",
            "行",
            "可以",
            "继续",
            "继续吧",
            "继续啊",
            "继续呀",
            "然后呢",
            "你说啥",
            "你说什么",
            "啥",
            "什么",
            "在吗",
            "还在吗",
            "ok",
            "okay",
        }
        return normalized in non_substantive_tokens

    def _is_explanation_request(self, text: str) -> bool:
        explanation_keywords = [
            "为什么",
            "为啥",
            "怎么理解",
            "什么意思",
            "展开",
            "详细",
            "具体说说",
            "具体讲讲",
            "讲讲",
            "解释",
            "分析一下",
            "对比一下",
            "比较一下",
            "哪个好",
            "哪个更适合",
            "区别",
            "风险",
            "注意什么",
            "怎么验证",
            "如何验证",
            "为什么优先",
            "值不值得",
            "适不适合",
        ]
        return any(keyword in text for keyword in explanation_keywords)

    def _is_analysis_generation_request(self, text: str) -> bool:
        analysis_keywords = [
            "热点",
            "趋势",
            "选题",
            "追踪",
            "赛道",
            "受众需求",
            "内容方向",
            "推荐几个",
            "推荐一些",
            "来一版",
            "出一版",
            "换个方向",
            "换成",
            "继续分析",
            "继续追踪",
            "继续给我",
            "再来几个",
            "再出几个",
            "再推荐",
            "重新给我",
        ]
        return any(keyword in text for keyword in analysis_keywords)

    def _strip_terminal_punctuation(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return re.sub(r"[。.!?！？；;，,\s]+$", "", value.strip())

    def _format_sentence_line(self, label: str, value: Any) -> str:
        text = self._strip_terminal_punctuation(value)
        return f"{label}{text}。" if text else ""

    def _display_trend_context_segment(self, value: Any) -> str:
        text = self._normalize_join_segment(value, strip_sentence_end=True)
        mapping = {
            "7d": "近七天",
            "xiaohongshu": "小红书",
        }
        return mapping.get(text.lower(), text)

    def _normalize_join_segment(self, value: Any, strip_sentence_end: bool = False) -> str:
        cleaned = self._sanitize_trend_copy(value)
        if not cleaned:
            return ""
        cleaned = self._tighten_trend_copy(cleaned)
        punctuation_pattern = r"[。.!?！？；;，,、：:/\s]+$"
        if strip_sentence_end:
            cleaned = re.sub(punctuation_pattern, "", cleaned).strip()
        else:
            cleaned = re.sub(punctuation_pattern, "", cleaned).strip()
        return cleaned

    def _format_trend_text(self, data: Dict[str, Any]) -> str:
        summary = data.get("trendSummary", {}) or {}
        if isinstance(summary, str):
            summary = {"summary": summary}
        trend_summary = self._normalize_join_segment(summary.get("summary"), strip_sentence_end=True)
        context_parts = [
            self._display_trend_context_segment(summary.get("period")),
            self._display_trend_context_segment(summary.get("platform")),
            self._display_trend_context_segment(summary.get("niche")),
        ]
        context_text = " / ".join([part for part in context_parts if part])

        lines = []
        if context_text:
            line = self._format_sentence_line("**趋势维度：**", context_text)
            if line:
                lines.append(line)
        if trend_summary:
            line = self._format_sentence_line("**趋势总结：**", trend_summary)
            if line:
                lines.append(line)

        hot_trends = data.get("hotTrends", []) or []
        if hot_trends:
            hot_items = []
            for item in hot_trends:
                name = self._normalize_join_segment(item.get("name"), strip_sentence_end=True)
                reason = self._normalize_join_segment(item.get("reason"), strip_sentence_end=True)
                if name and reason:
                    hot_items.append(f"{name}：{reason}")
                elif name:
                    hot_items.append(name)
            if hot_items:
                line = self._format_sentence_line("**当前热点包括：**", "；".join(hot_items))
                if line:
                    lines.append(line)

        audience_needs = data.get("audienceNeeds", []) or []
        if audience_needs:
            needs_items = []
            for item in audience_needs:
                need = self._normalize_join_segment(item.get("need"), strip_sentence_end=True)
                evidence = self._normalize_join_segment(item.get("evidence"), strip_sentence_end=True)
                if need and evidence:
                    needs_items.append(f"{need}：{evidence}")
                elif need:
                    needs_items.append(need)
            if needs_items:
                line = self._format_sentence_line("**受众需求：**", "；".join(needs_items))
                if line:
                    lines.append(line)

        topics = data.get("topicOpportunities", []) or []
        if topics:
            topic_lines = []
            for idx, topic in enumerate(topics[:3], 1):
                title = self._normalize_join_segment(topic.get("title"), strip_sentence_end=True)
                angle = self._normalize_join_segment(topic.get("angle"), strip_sentence_end=True)
                if title and angle:
                    topic_lines.append(f"{idx}. {title}，角度：{angle}")
                elif title:
                    topic_lines.append(f"{idx}. {title}")
            if topic_lines:
                lines.append("**推荐选题：**\n" + "\n".join(topic_lines))

        if lines:
            return "\n".join(lines)
        reply = data.get("reply")
        if isinstance(reply, str) and reply.strip():
            return self._sanitize_trend_reply(reply.strip())
        return "暂无趋势结果。"

    def _sanitize_trend_reply(self, text: Any) -> str:
        if not isinstance(text, str):
            return ""

        cleaned = text.strip()
        if not cleaned:
            return ""

        # 对聊天回复只做轻量清理，保留换行/列表/段落结构，避免把 Markdown 压成一整行。
        replacements = [
            r"这与您[^。；;，,\n]*?(高度契合|相符|匹配|一致)",
            r"与您[^。；;，,\n]*?(高度契合|相符|匹配|一致)",
            r"符合您[^。；;，,\n]*?(人设|定位|账号方向)",
            r"契合您[^。；;，,\n]*?(人设|定位|账号方向)",
            r"您的人设中[^。；;]*",
            r"您的人设中[^。；;]*",
            r"您人设的核心[^。；;]*",
            r"根据您[^。；;，,\n]*?(人设|定位|账号方向)[^。；;]*",
            r"这直接对应了您[^。；;]*",
            r"您的“[^”]+”[^。；;，,\n]*?(天然优势|特点|特长|标签)",
            r"您[^。；;，,\n]*?(有天然优势|更适合|比较适合)[^。；;]*",
        ]
        for pattern in replacements:
            cleaned = re.sub(pattern, "", cleaned)

        cleaned = re.sub(r"[（(]\s*[您你]的?(人设|定位|账号方向)[^）)]*[）)]", "", cleaned)
        cleaned = re.sub(r"[ \t]+", " ", cleaned)
        cleaned = re.sub(r"\n[ \t]+", "\n", cleaned)
        cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
        cleaned = re.sub(r"(；\s*){2,}", "；", cleaned)
        cleaned = re.sub(r"(，\s*){2,}", "，", cleaned)
        cleaned = re.sub(r"。{2,}", "。", cleaned)
        cleaned = re.sub(r"(?m)^[；，、\s]+", "", cleaned)
        cleaned = re.sub(r"(?m)[；，、\s]+$", "", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

        return cleaned.strip()

    def _sanitize_trend_copy(self, text: Any) -> str:
        if not isinstance(text, str):
            return ""

        cleaned = text.strip()
        if not cleaned:
            return ""

        replacements = [
            r"这与您[^。；;，,\n]*?(高度契合|相符|匹配|一致)",
            r"与您[^。；;，,\n]*?(高度契合|相符|匹配|一致)",
            r"符合您[^。；;，,\n]*?(人设|定位|账号方向)",
            r"契合您[^。；;，,\n]*?(人设|定位|账号方向)",
            r"您的人设中[^。；;]*",
            r"您的人设中[^。；;]*",
            r"您人设的核心[^。；;]*",
            r"根据您[^。；;，,\n]*?(人设|定位|账号方向)[^。；;]*",
            r"这直接对应了您[^。；;]*",
            r"您的“[^”]+”[^。；;，,\n]*?(天然优势|特点|特长|标签)",
            r"您[^。；;，,\n]*?(有天然优势|更适合|比较适合)[^。；;]*",
        ]
        for pattern in replacements:
            cleaned = re.sub(pattern, "", cleaned)

        cleaned = re.sub(r"[（(]\s*[您你]的?(人设|定位|账号方向)[^）)]*[）)]", "", cleaned)
        cleaned = re.sub(r"(；\s*){2,}", "；", cleaned)
        cleaned = re.sub(r"(，\s*){2,}", "，", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned)
        cleaned = re.sub(r"^[；，、\s]+", "", cleaned)
        cleaned = re.sub(r"[；，、\s]+$", "", cleaned)
        cleaned = re.sub(r"。{2,}", "。", cleaned)
        cleaned = self._enforce_graphic_text_copy(cleaned)

        return cleaned.strip()

    def _enforce_graphic_text_copy(self, text: str) -> str:
        replacements = [
            (r"B站长视频|b站长视频|B 站长视频|b 站长视频", "小红书图文笔记"),
            (r"抖音短视频|抖音脚本|抖音视频", "小红书图文笔记"),
            (r"短视频脚本|视频脚本|视频分镜|口播脚本|拍摄脚本", "图文笔记"),
            (r"短视频", "图文笔记"),
            (r"视频", "图文"),
            (r"拍摄难度", "素材准备难度"),
            (r"拍摄周期", "图文制作周期"),
            (r"拍摄成本", "素材准备成本"),
            (r"镜头", "图片"),
        ]
        cleaned = text
        for pattern, replacement in replacements:
            cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
        return cleaned

    def _tighten_trend_copy(self, text: Any) -> str:
        if not isinstance(text, str):
            return ""

        cleaned = text.strip()
        if not cleaned:
            return ""

        cleaned = re.sub(r"\s+", " ", cleaned)
        cleaned = re.sub(r"(；\s*){2,}", "；", cleaned)
        cleaned = re.sub(r"(，\s*){2,}", "，", cleaned)
        cleaned = re.sub(r"。{2,}", "。", cleaned)
        cleaned = re.sub(r"^[；，、:\s]+", "", cleaned)
        cleaned = re.sub(r"[；，、:\s]+$", "", cleaned)
        return cleaned.strip()

    def _normalize_history_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(record)
        topics = [
            topic.strip()
            for topic in record.get("topics", [])
            if isinstance(topic, str) and topic.strip()
        ] if isinstance(record.get("topics"), list) else []
        tags = [
            tag.strip()
            for tag in record.get("tags", [])
            if isinstance(tag, str) and tag.strip()
        ] if isinstance(record.get("tags"), list) else []

        normalized["trackName"] = self._sanitize_trend_copy(record.get("trackName"))
        normalized["trackTime"] = record.get("trackTime", "").strip() if isinstance(record.get("trackTime"), str) else ""
        normalized["userPrompt"] = record.get("userPrompt", "").strip() if isinstance(record.get("userPrompt"), str) else ""
        normalized["trends"] = self._tighten_trend_copy(self._sanitize_trend_copy(record.get("trends")))
        normalized["audience"] = self._tighten_trend_copy(self._sanitize_trend_copy(record.get("audience")))
        normalized["topics"] = topics
        normalized["tags"] = tags

        card_preview = self._normalize_history_card_preview(normalized)
        if card_preview["discoveryKeywords"] or card_preview["shortTopics"]:
            normalized["cardPreview"] = card_preview
        else:
            normalized.pop("cardPreview", None)

        return normalized

    def _normalize_history_card_preview(self, record: Dict[str, Any]) -> Dict[str, list[str]]:
        raw_preview = record.get("cardPreview") if isinstance(record.get("cardPreview"), dict) else {}
        discovery_keywords = self._normalize_preview_terms(raw_preview.get("discoveryKeywords") if raw_preview else [])
        short_topics = self._normalize_preview_terms(raw_preview.get("shortTopics") if raw_preview else [])

        if len(discovery_keywords) < 2:
            discovery_keywords = self._merge_preview_terms(discovery_keywords, self._split_preview_text(record.get("trends")))

        if len(discovery_keywords) < 2:
            discovery_keywords = self._merge_preview_terms(
                discovery_keywords,
                [self._short_preview_phrase(tag) for tag in record.get("tags", []) if isinstance(tag, str)],
            )

        if len(discovery_keywords) < 2:
            discovery_keywords = self._merge_preview_terms(
                discovery_keywords,
                [self._short_preview_phrase(record.get("trackName"))],
            )

        if len(short_topics) < 2:
            short_topics = self._merge_preview_terms(
                short_topics,
                [self._short_preview_phrase(topic) for topic in record.get("topics", []) if isinstance(topic, str)],
            )

        if len(short_topics) < 2:
            short_topics = self._merge_preview_terms(short_topics, discovery_keywords)

        return {
            "discoveryKeywords": discovery_keywords[:3],
            "shortTopics": short_topics[:3],
        }
