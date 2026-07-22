from ...adapters.agent.client import AgentClient
from ...adapters.agent.builder import ContextBuilder
from ...adapters.agent.options import build_agent_options
from ...schemas.agent.protocol import AgentRunRequest
from ...database.crud.content_crud import ContentCRUD
from ...services.memory import RollingMemoryService
from ...services.agent_debug import build_agent_debug_payload, build_agent_option_overrides
from ...services.persona import PersonaService
from ...services.trend import TrendService
from typing import Any, Dict
import re

XHS_TITLE_MAX_CHARS = 20
XHS_PUBLISH_BODY_MAX_CHARS = 1000
XHS_INTRO_SOFT_MAX_CHARS = 180
XHS_ENDING_SOFT_MAX_CHARS = 160


class ContentService:
    def __init__(self, db=None):
        self.client = AgentClient()
        self.builder = ContextBuilder(db)
        self.content_crud = ContentCRUD()
        self.persona_service = PersonaService(db)
        self.trend_service = TrendService(db)
        self.memory_service = RollingMemoryService()
        self.personas = {}  # 存储人设信息，以集合形式

    async def draft(
        self,
        user_id: str,
        topic: str,
        instruction: str,
        conversation_history: list = None,
        current_draft: dict = None,
        revision_instruction: str = None,
        writing_entry_source: dict = None,
        persona: dict = None,
        prompt_override: str = None,
        agent_debug: dict | None = None,
        conversation_scope_id: str | None = None,
    ) -> dict:
        selected_topic = {"topic": topic}
        if conversation_scope_id or current_draft:
            try:
                context = await self.builder.build_content_draft_context(
                    user_id,
                    selected_topic,
                    conversation_history,
                    writing_entry_source,
                    conversation_scope_id=conversation_scope_id,
                    current_artifact=current_draft,
                )
            except TypeError:
                context = await self.builder.build_content_draft_context(
                    user_id,
                    selected_topic,
                    conversation_history,
                    writing_entry_source,
                )
        else:
            context = await self.builder.build_content_draft_context(
                user_id,
                selected_topic,
                conversation_history,
                writing_entry_source,
            )
        if persona:
            context["savedPersona"] = persona
        if current_draft:
            context["currentDraft"] = current_draft
        is_initial_page_first_turn = not current_draft and self._should_force_initial_full_draft(conversation_history)
        force_full_draft = is_initial_page_first_turn if not current_draft else self._should_force_full_draft(revision_instruction or instruction, conversation_history)
        agent_instruction = (
            self._build_initial_full_draft_instruction(topic, instruction)
            if is_initial_page_first_turn
            else instruction
        )
        input_data = {
            "topic": topic,
            "userInstruction": agent_instruction,
            "originalUserInstruction": instruction,
        }
        if current_draft:
            input_data["currentDraft"] = current_draft
            input_data["revisionInstruction"] = revision_instruction or instruction
        request = AgentRunRequest(
            requestId="req_content_draft",
            taskType="content.revise" if current_draft else "content.draft",
            platform="xiaohongshu",
            userId=user_id,
            input=input_data,
            context=context,
            options=build_agent_options(
                forceFullDraft=force_full_draft,
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

        draft = (response.data or {}).get("revisedDraft") or (response.data or {}).get("draft", {}) or {}
        complete_draft = self._build_complete_draft(response.data)
        suggestions = self._read_suggestions(response.data) if complete_draft else []
        next_memory_state = await self.memory_service.refresh_state(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="content",
            raw_history=conversation_history,
            current_artifact=complete_draft,
        )
        return {
            "data": {
                "discussionOnly": complete_draft is None,
                "completeDraft": complete_draft,
                "draft": draft,
                "writingEntrySource": writing_entry_source or {},
                "suggestions": suggestions,
                "text": self._format_content_text(response.data),
                "raw": response.data,
                "conversationSummary": next_memory_state.get("conversationSummary"),
                "memoryMeta": next_memory_state.get("memoryMeta"),
            },
            "warnings": response.warnings or [],
            "debug": build_agent_debug_payload(response, agent_debug),
        }

    def save_draft_record(self, user_id: str, draft: Dict[str, Any]) -> dict:
        normalized_draft = self._normalize_saved_draft(draft)
        self.content_crud.save_draft(user_id, normalized_draft)
        return {"status": "success", "data": normalized_draft}

    def delete_draft_record(self, user_id: str, draft: Dict[str, Any]) -> dict:
        draft_id = draft.get("id")
        if not draft_id:
            return {"status": "failed", "message": "Invalid draft"}
        success = self.content_crud.delete_draft(user_id, draft_id)
        if success:
            return {"status": "success", "message": "草稿已删除"}
        return {"status": "failed", "message": "草稿不存在或删除失败"}

    def get_draft_history(self, user_id: str) -> list:
        return self.content_crud.get_draft_history(user_id)

    def _strip_terminal_punctuation(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return re.sub(r"[。.!?！？；;，,\s]+$", "", value.strip())

    def _normalize_inline_text(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return re.sub(r"\s+", " ", value).strip()

    def _normalize_segment_text(self, value: Any) -> str:
        normalized = self._normalize_inline_text(value)
        if not normalized:
            return ""
        normalized = re.sub(r"[。.!?！？；;，,、：:\s]+$", "", normalized)
        return normalized.strip()

    def _normalize_joined_segments(self, values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        segments: list[str] = []
        for item in values:
            normalized = self._normalize_segment_text(item)
            if normalized:
                segments.append(normalized)
        return segments

    def _format_labeled_text_line(self, label: str, value: Any, ending: str = "") -> str:
        normalized = self._normalize_inline_text(value)
        if not normalized:
            return ""
        suffix = ending if ending and not re.search(rf"{re.escape(ending)}$", normalized) else ""
        return f"{label}{normalized}{suffix}"

    def _limit_xhs_title(self, value: Any) -> str:
        if not isinstance(value, str):
            return ""
        return value.strip()[:XHS_TITLE_MAX_CHARS].strip()

    def _format_content_text(self, data: Dict[str, Any]) -> str:
        draft = data.get("revisedDraft") or data.get("draft", {}) or {}
        lines = []
        selected_title_text = self._strip_terminal_punctuation(draft.get("selectedTitle") or draft.get("title"))
        if selected_title := draft.get("selectedTitle") or draft.get("title"):
            line = self._format_labeled_text_line("**推荐标题：**", selected_title_text)
            if line:
                lines.append(line)
        title_options = draft.get("titleOptions")
        if isinstance(title_options, list):
            normalized_titles = [
                self._strip_terminal_punctuation(item)
                for item in title_options
                if isinstance(item, str) and item.strip()
            ]
            normalized_titles = [item for item in normalized_titles if item and item != selected_title_text]
            if normalized_titles:
                line = self._format_labeled_text_line("**备选标题：**", " / ".join(normalized_titles[:4]))
                if line:
                    lines.append(line)
        cover = draft.get("coverSuggestion") or {}
        if cover:
            cover_text = []
            if cover.get("mainText"):
                cover_text.append(f"封面文字：{self._normalize_segment_text(cover['mainText'])}")
            if cover.get("layout"):
                cover_text.append(f"排版：{self._normalize_segment_text(cover['layout'])}")
            if cover.get("visualStyle"):
                cover_text.append(f"风格：{self._normalize_segment_text(cover['visualStyle'])}")
            if cover_text:
                line = self._format_labeled_text_line("**封面建议：**", "；".join(cover_text))
                if line:
                    lines.append(line)

        image_structure = draft.get("imageTextStructure")
        if isinstance(image_structure, list) and image_structure:
            line = self._format_labeled_text_line("**图片顺序：**", "；".join(self._normalize_joined_segments(image_structure)))
            if line:
                lines.append(line)

        intro = draft.get("intro") or draft.get("hook")
        if intro:
            line = self._format_labeled_text_line("**正文开头：**", intro)
            if line:
                lines.append(line)
        if body := draft.get("body"):
            if isinstance(body, list):
                body_parts = self._normalize_joined_segments(body)
                body_text = "\n".join(body_parts)
            else:
                body_text = self._normalize_inline_text(body)
            line = f"**正文内容：**\n{body_text}" if body_text else ""
            if line:
                lines.append(line)
        if ending := draft.get("ending"):
            ending_text = self._strip_terminal_punctuation(self._normalize_inline_text(ending))
            line = self._format_labeled_text_line("**结尾互动：**", ending_text)
            if line:
                lines.append(line)
        if tags := draft.get("tags"):
            if isinstance(tags, list):
                line = self._format_labeled_text_line("**标签建议：**", "，".join(self._normalize_joined_segments(tags)))
            else:
                line = self._format_labeled_text_line("**标签建议：**", self._normalize_segment_text(tags))
            if line:
                lines.append(line)

        if lines:
            return self._strip_ai_template_wrappers("\n\n".join(lines))
        reply = data.get("reply")
        if isinstance(reply, str) and reply.strip():
            return self._strip_ai_template_wrappers(reply)
        return "暂无内容草稿结果。"

    def _strip_ai_template_wrappers(self, text: str) -> str:
        cleaned = re.sub(r"[ \t]+", " ", text or "").strip()
        if not cleaned:
            return ""
        cleaned = re.sub(r"^(以下是|下面是|这里是)(我)?(为你|帮你)?(生成|整理|准备)?(的)?(一版|一篇)?[^：:。\n]{0,16}[：:。]\s*", "", cleaned)
        cleaned = re.sub(r"\s*(希望对你有帮助|如果你还需要[，,]?.*?可以继续优化|欢迎点赞收藏关注)[。!！]?\s*$", "", cleaned)
        return cleaned.strip()

    def _build_complete_draft(self, data: Dict[str, Any]) -> Dict[str, Any] | None:
        draft = data.get("revisedDraft") or data.get("draft", {}) or {}
        if not isinstance(draft, dict):
            return None

        title = draft.get("selectedTitle")
        title_options = draft.get("titleOptions")
        intro = draft.get("intro") or draft.get("hook")
        body = draft.get("body")
        ending = draft.get("ending")
        tags = draft.get("tags")
        cover_suggestion = draft.get("coverSuggestion")
        image_text_structure = draft.get("imageTextStructure")
        card_preview = self._build_card_preview(data, draft, title, tags)

        if not isinstance(title, str) or not title.strip():
            return None
        if not isinstance(intro, str) or not intro.strip():
            return None
        if isinstance(body, list):
            body_lines = [item.strip() for item in body if isinstance(item, str) and item.strip()]
        elif isinstance(body, str) and body.strip():
            body_lines = [line.strip() for line in body.splitlines() if line.strip()]
        else:
            body_lines = []
        if not body_lines:
            return None
        if not isinstance(ending, str) or not ending.strip():
            return None
        if isinstance(tags, list):
            tag_list = [tag.replace("#", "").strip() for tag in tags if isinstance(tag, str) and tag.strip()]
        elif isinstance(tags, str) and tags.strip():
            tag_list = [tag.strip() for tag in re.split(r"[\s,，、#]+", tags) if tag.strip()]
        else:
            tag_list = []
        if not tag_list:
            return None

        body_lines = self._strip_inline_tag_lines(body_lines, tag_list)
        if not body_lines:
            return None

        limited_title = self._limit_xhs_title(title)
        if not limited_title:
            return None
        limited_intro, limited_body_lines, limited_ending = self._limit_xhs_publish_body(
            intro.strip(),
            body_lines,
            ending.strip(),
        )

        complete_draft = {
            "title": limited_title,
            "intro": limited_intro,
            "body": limited_body_lines,
            "ending": limited_ending,
            "tags": tag_list,
            "cardPreview": card_preview,
        }
        if isinstance(title_options, list):
            normalized_titles = [self._limit_xhs_title(item) for item in title_options if isinstance(item, str) and item.strip()]
            normalized_titles = [item for item in normalized_titles if item]
            if normalized_titles:
                complete_draft["titleOptions"] = normalized_titles[:5]
        if isinstance(cover_suggestion, dict):
            normalized_cover = {
                key: value.strip()
                for key, value in cover_suggestion.items()
                if key in {"mainText", "layout", "visualStyle"} and isinstance(value, str) and value.strip()
            }
            if normalized_cover:
                complete_draft["coverSuggestion"] = normalized_cover
        if isinstance(image_text_structure, list):
            normalized_images = [item.strip() for item in image_text_structure if isinstance(item, str) and item.strip()]
            if normalized_images:
                complete_draft["imageTextStructure"] = normalized_images[:8]

        return complete_draft

    def _build_card_preview(self, data: Dict[str, Any], draft: Dict[str, Any], title: Any, tags: Any) -> Dict[str, list[str]]:
        raw_preview = draft.get("cardPreview") if isinstance(draft.get("cardPreview"), dict) else {}
        if not raw_preview and isinstance(data.get("cardPreview"), dict):
            raw_preview = data.get("cardPreview")

        keywords = self._normalize_preview_terms(raw_preview.get("keywords") if raw_preview else [])
        if len(keywords) < 2:
            keywords = self._merge_preview_terms(keywords, [self._short_preview_phrase(title)])

        tag_candidates = tags if isinstance(tags, list) else re.split(r"[\s,，、#]+", tags) if isinstance(tags, str) else []
        if len(keywords) < 2:
            keywords = self._merge_preview_terms(keywords, [self._short_preview_phrase(tag) for tag in tag_candidates])

        if len(keywords) < 2:
            body = draft.get("body")
            if isinstance(body, str):
                keywords = self._merge_preview_terms(keywords, self._split_preview_text(body))
            elif isinstance(body, list):
                keywords = self._merge_preview_terms(keywords, [self._short_preview_phrase(item) for item in body])

        return {"keywords": keywords[:3]}

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
        if not isinstance(text, str):
            return []
        return [self._short_preview_phrase(item) for item in re.split(r"[、,，；;\n。]+", text)]

    def _short_preview_phrase(self, text: Any) -> str:
        if not isinstance(text, str):
            return ""
        cleaned = text.replace("#", "").strip()
        if not cleaned:
            return ""

        if "考证" in cleaned and ("坑" in cleaned or "避坑" in cleaned):
            return "考证避坑"
        if "考证" in cleaned and ("规划" in cleaned or "计划" in cleaned):
            return "考证规划"
        if "自律" in cleaned:
            return "自律补救" if "失败" in cleaned or "补救" in cleaned else "低成本自律"
        if "学习" in cleaned and ("低成本" in cleaned or "方法" in cleaned):
            return "低成本学习"
        if "资料" in cleaned:
            return "资料选择"
        if "通勤妆" in cleaned:
            return "新手通勤妆"
        if "彩妆" in cleaned and ("清单" in cleaned or "平价" in cleaned or "百元" in cleaned):
            return "百元彩妆清单"
        if "底妆" in cleaned and ("坑" in cleaned or "避坑" in cleaned):
            return "底妆避坑"
        if "时间" in cleaned and ("规划" in cleaned or "管理" in cleaned):
            return "时间管理"

        phrase = re.split(r"[：:；;，,。.!?！？\n]", cleaned, maxsplit=1)[0]
        phrase = re.sub(r"(大学生|小红书|第一次|如何|怎么|教程|方法|清单|真的|不要|别再|这篇|一篇|几个)", "", phrase)
        phrase = re.sub(r"\s+", "", phrase)
        if not phrase:
            phrase = re.sub(r"\s+", "", cleaned)
        return phrase[:14]

    def _strip_inline_tag_lines(self, body_lines: list[str], tags: list[str]) -> list[str]:
        return [line for line in body_lines if not self._is_inline_tag_line(line, tags)]

    def _limit_xhs_publish_body(self, intro: str, body_lines: list[str], ending: str) -> tuple[str, list[str], str]:
        intro = self._clip_text(intro.strip(), XHS_INTRO_SOFT_MAX_CHARS)
        ending = self._clip_text(ending.strip(), XHS_ENDING_SOFT_MAX_CHARS)
        body_budget = XHS_PUBLISH_BODY_MAX_CHARS - len(intro) - len(ending)
        if body_budget < 80:
            intro = self._clip_text(intro, 80)
            ending = self._clip_text(ending, 80)
            body_budget = XHS_PUBLISH_BODY_MAX_CHARS - len(intro) - len(ending)

        limited_body = self._clip_lines_to_budget(body_lines, max(1, body_budget))
        return intro, limited_body or [self._clip_text(body_lines[0], 1)], ending

    def _clip_lines_to_budget(self, lines: list[str], budget: int) -> list[str]:
        result: list[str] = []
        remaining = budget
        for line in lines:
            cleaned = line.strip()
            if not cleaned or remaining <= 0:
                break
            clipped = self._clip_text(cleaned, remaining)
            if clipped:
                result.append(clipped)
                remaining -= len(clipped)
        return result

    def _clip_text(self, text: str, max_chars: int) -> str:
        cleaned = text.strip()
        if max_chars <= 0:
            return ""
        if len(cleaned) <= max_chars:
            return cleaned
        if max_chars <= 1:
            return cleaned[:max_chars]
        return cleaned[: max_chars - 1].rstrip("，,、；;：:。.!！?？ ") + "…"

    def _is_inline_tag_line(self, line: str, tags: list[str]) -> bool:
        normalized = line.strip()
        if not normalized:
            return False

        explicit_tag_heading = bool(re.match(r"^(标签建议|推荐标签|标签|hashtags?)\s*[：:]", normalized, flags=re.IGNORECASE))
        inline_tags = self._read_inline_body_tags(normalized)
        if not inline_tags:
            return False

        normalized_tags = [self._normalize_tag_token(tag) for tag in tags if self._normalize_tag_token(tag)]
        normalized_inline_tags = [self._normalize_tag_token(tag) for tag in inline_tags if self._normalize_tag_token(tag)]
        all_tags_match = all(tag in normalized_tags for tag in normalized_inline_tags)
        return explicit_tag_heading or all_tags_match

    def _read_inline_body_tags(self, line: str) -> list[str]:
        body_only = re.sub(r"^\s*(?:标签建议|推荐标签|标签|hashtags?)\s*[：:]\s*", "", line, flags=re.IGNORECASE).strip()
        if "#" not in body_only:
            return []
        return [item.replace("#", "").strip() for item in re.findall(r"#[^\s#，,、;；]+", body_only) if item.strip()]

    def _normalize_tag_token(self, value: str) -> str:
        return re.sub(r"[：:；;，,。.!?！？\s]+", "", value.replace("#", "").strip()).lower()

    def _read_suggestions(self, data: Dict[str, Any]) -> list[Dict[str, str]]:
        suggestions = data.get("suggestions") or []
        if not isinstance(suggestions, list):
            return []

        normalized = []
        for item in suggestions:
            if not isinstance(item, dict):
                continue
            label = item.get("label")
            instruction = item.get("instruction")
            intent = item.get("intent")
            if isinstance(label, str) and label.strip() and isinstance(instruction, str) and instruction.strip():
                normalized.append(
                    {
                        "label": label.strip(),
                        "instruction": instruction.strip(),
                        "intent": intent.strip() if isinstance(intent, str) and intent.strip() else "revise_general",
                    }
                )
        return normalized[:5]

    def _should_force_initial_full_draft(self, conversation_history: list | None = None) -> bool:
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

    def _build_initial_full_draft_instruction(self, topic: str, instruction: str) -> str:
        raw_topic = (topic or "").strip()
        raw_instruction = (instruction or "").strip() or raw_topic
        return "\n".join(
            [
                "这是内容撰写初始页的首条业务输入。",
                "身份边界：顶流小猪梨只是 Agent 助手昵称，不是用户的人设、账号名或内容主角；用户的具体人设只以 context.savedPersona 为准。",
                "请把用户原始输入直接理解为本轮要写的主题、口吻要求或写作方向，不要先停留在讨论态，也不要只给思路。",
                "请直接输出一篇可展示、可保存、能直接改用的小红书图文笔记草稿，重点给标题备选、封面文字、正文第一句、正文、图片顺序、结尾互动、标签和 cardPreview。",
                "标题备选和选中标题都必须控制在 20 个中文字符以内，符合小红书标题长度限制。",
                "表达要像真实小红书图文笔记，少用运营术语和报告腔；不要生成视频脚本、分镜或视频建议。",
                f"主题：{raw_topic}",
                f"用户原始输入：{raw_instruction}",
            ]
        )

    def _should_force_full_draft(self, instruction: str, conversation_history: list | None = None) -> bool:
        text = (instruction or "").strip().lower()
        if not text:
            return False

        explicit_apply_patterns = [
            r"^改",
            r"^修改",
            r"^重写",
            r"^重做",
            r"^优化",
            r"^润色",
            r"^压缩",
            r"^缩短",
            r"^扩写",
            r"^补充",
            r"^增加",
            r"^删除",
            r"^替换",
            r"^换成",
            r"^按.*改",
            r"^照.*改",
            r"^直接改",
            r"^直接出",
            r"^直接写",
            r"^给我最终版",
            r"^给我定稿",
            r"^定稿",
            r"^保存",
            r"^应用",
        ]
        if any(re.search(pattern, text) for pattern in explicit_apply_patterns):
            return True

        apply_keywords = [
            "改一下",
            "改成",
            "改短",
            "改长",
            "改标题",
            "换标题",
            "换个标题",
            "换个结尾",
            "换个开头",
            "正文更",
            "结尾更",
            "标题更",
            "口语化",
            "生活化",
            "重新写",
            "重写一版",
            "出一版",
            "出最终版",
            "按这个改",
            "按你说的改",
            "应用修改",
            "直接输出",
            "完整版本",
            "最终版本",
        ]
        if any(keyword in text for keyword in apply_keywords):
            return True

        discussion_signals = [
            "怎么样",
            "好不好",
            "合适吗",
            "可以吗",
            "行不行",
            "要不要",
            "先别",
            "先不要",
            "先分析",
            "先看看",
            "先聊聊",
            "先说说",
            "你觉得",
            "怎么看",
            "为什么",
            "有没有问题",
            "哪里能改",
            "还有什么问题",
            "哪个更好",
            "区别",
            "对比",
            "比较",
            "分析",
            "建议",
            "思路",
            "方向",
            "角度",
        ]
        if any(signal in text for signal in discussion_signals):
            return False

        history = conversation_history or []
        if len(history) <= 1:
            return False

        return False

    def _normalize_saved_draft(self, draft: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(draft or {})
        structured = normalized.get("structured")
        if isinstance(structured, dict):
            note_title = structured.get("noteTitle")
            if isinstance(note_title, str) and note_title.strip():
                normalized["title"] = note_title.strip()
        return normalized
