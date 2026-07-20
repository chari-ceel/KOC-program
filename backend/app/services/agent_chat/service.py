from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Literal, Optional
from uuid import uuid4

from ...database.crud.memory_crud import MemoryCRUD
from ..content import ContentService
from ..persona import PersonaService
from ..trend import TrendService

AgentStep = Literal["persona", "trending", "content", "image_guidance", "done"]
CHINA_TZ = timezone(timedelta(hours=8))
SUMMARY_TITLES = {
    "persona": "人设打造",
    "trending": "热门追踪",
    "content": "内容撰写",
}


class UnifiedAgentChatService:
    def __init__(
        self,
        *,
        memory_crud: Optional[MemoryCRUD] = None,
        persona_service: Optional[PersonaService] = None,
        trend_service: Optional[TrendService] = None,
        content_service: Optional[ContentService] = None,
    ) -> None:
        self.memory_crud = memory_crud or MemoryCRUD()
        self.persona_service = persona_service or PersonaService()
        self.trend_service = trend_service or TrendService()
        self.content_service = content_service or ContentService()
        try:
            self.memory_crud.ensure_agent_chat_indexes()
        except Exception:
            # Focused tests may run without Mongo; actual read/write failures still surface.
            pass

    async def chat(
        self,
        *,
        user_id: str,
        message: str,
        conversation_id: Optional[str] = None,
        current_step: Optional[str] = None,
        selected_persona_id: Optional[str] = None,
        selected_topic_id: Optional[str] = None,
        expose_debug: bool = False,
    ) -> Dict[str, Any]:
        clean_message = (message or "").strip()
        if not clean_message:
            return self._error_response(conversation_id, "请输入你想创作的内容。")

        resolved_conversation_id = conversation_id or f"conv_{uuid4().hex[:8]}"
        conversation = self._load_or_create_conversation(user_id, resolved_conversation_id)
        module_memories = self._load_module_memories(user_id, resolved_conversation_id, conversation)
        selected_persona = self._selected_memory(user_id, resolved_conversation_id, selected_persona_id, "persona")
        if selected_persona:
            module_memories["persona"] = selected_persona
            conversation["active_persona_memory_id"] = selected_persona["memory_id"]

        previous_step = conversation.get("current_step") or current_step or "persona"
        step = self._decide_step(clean_message, current_step or previous_step, module_memories)
        if self._should_start_new_persona_conversation(clean_message, step, module_memories, selected_persona_id):
            resolved_conversation_id = f"conv_{uuid4().hex[:8]}"
            conversation = self._load_or_create_conversation(user_id, resolved_conversation_id)
            module_memories = {"persona": None, "trending": None, "content": None}
            previous_step = "persona"

        history_before = self.memory_crud.list_agent_chat_messages(user_id, resolved_conversation_id)
        user_message = self.memory_crud.save_agent_chat_message(
            user_id=user_id,
            conversation_id=resolved_conversation_id,
            role="user",
            content=clean_message,
            step=step,
        )
        conversation_history = self._to_agent_history([*history_before, user_message])

        handler_result = await self._run_step(
            user_id=user_id,
            message=clean_message,
            step=step,
            conversation_id=resolved_conversation_id,
            conversation_history=conversation_history,
            module_memories=module_memories,
            selected_topic_id=selected_topic_id,
        )
        assistant_content = handler_result["reply"]
        assistant_message = self.memory_crud.save_agent_chat_message(
            user_id=user_id,
            conversation_id=resolved_conversation_id,
            role="assistant",
            content=assistant_content,
            step=step,
        )

        created_memory = None
        if handler_result.get("done") and isinstance(handler_result.get("payload"), dict):
            created_memory = self.memory_crud.save_agent_module_memory(
                user_id=user_id,
                conversation_id=resolved_conversation_id,
                module=step,
                title=SUMMARY_TITLES[step],
                summary_text=handler_result["summary_text"],
                payload=handler_result["payload"],
                source_message_id=assistant_message["message_id"],
                memory_id=handler_result.get("memory_id"),
                parent_refs=handler_result.get("parent_refs"),
            )
            module_memories[step] = created_memory
            if step == "persona":
                module_memories["trending"] = None
                module_memories["content"] = None
            elif step == "trending":
                module_memories["content"] = None

        active_ids = self._active_ids(conversation, module_memories)
        next_step = self._next_step(module_memories)
        current_state_step = next_step if next_step != "done" else "done"
        if step == "persona" and created_memory:
            current_state_step = "trending"
        elif step == "trending" and created_memory:
            current_state_step = "content"
        elif step == "content" and created_memory:
            current_state_step = "done"

        conversation_doc = self.memory_crud.upsert_agent_chat_conversation(
            user_id,
            resolved_conversation_id,
            {
                "current_step": current_state_step,
                "active_persona_memory_id": active_ids.get("persona"),
                "active_trending_memory_id": active_ids.get("trending"),
                "active_content_memory_id": active_ids.get("content"),
                "title": self._conversation_title(module_memories),
                "persona_summary": self._conversation_persona_summary(module_memories),
            },
        )

        response = {
            "conversation_id": resolved_conversation_id,
            "conversation_title": conversation_doc.get("title") or "新的创作对话",
            "assistant_message": {
                "id": assistant_message["message_id"],
                "role": "assistant",
                "content": assistant_content,
                "created_at": self._iso(assistant_message["created_at"]),
            },
            "current_step": step,
            "next_step": None if current_state_step == "done" else current_state_step,
            "summary": self._build_summary(user_id, resolved_conversation_id, conversation_doc),
            "memory_refs": self._build_memory_refs(resolved_conversation_id, conversation_doc),
        }
        if expose_debug:
            response["debug"] = {
                "step_decision": step,
                "previous_step": previous_step,
                "used_memory_blocks": self._used_memory_blocks(step, module_memories),
                "created_memory_id": created_memory.get("memory_id") if created_memory else None,
                "called_service": handler_result.get("called_service"),
            }
        return response

    def list_conversations(self, *, user_id: str, limit: int = 50) -> Dict[str, Any]:
        records = self.memory_crud.list_agent_chat_conversations(user_id, limit=limit)
        conversations = []
        for record in records:
            conversation_id = record.get("conversation_id")
            if not isinstance(conversation_id, str) or not conversation_id:
                continue
            conversations.append(
                {
                    "conversation_id": conversation_id,
                    "title": record.get("title") or record.get("persona_summary") or "新的创作对话",
                    "current_step": record.get("current_step") or "persona",
                    "summary": self._build_summary(user_id, conversation_id, record),
                    "memory_refs": self._build_memory_refs(conversation_id, record),
                    "updated_at": self._iso(record.get("updated_at")),
                }
            )
        return {"conversations": conversations}

    def get_conversation(self, *, user_id: str, conversation_id: str) -> Optional[Dict[str, Any]]:
        conversation = self.memory_crud.get_agent_chat_conversation(user_id, conversation_id)
        if not conversation:
            return None
        return {
            "conversation_id": conversation_id,
            "conversation_title": conversation.get("title") or conversation.get("persona_summary") or "新的创作对话",
            "current_step": conversation.get("current_step") or "persona",
            "messages": [
                {
                    "id": message["message_id"],
                    "role": message["role"],
                    "content": message["content"],
                    "step": message.get("step"),
                    "created_at": self._iso(message.get("created_at")),
                }
                for message in self.memory_crud.list_agent_chat_messages(user_id, conversation_id)
                if message.get("message_id") and message.get("role") in {"user", "assistant"}
            ],
            "summary": self._build_summary(user_id, conversation_id, conversation),
            "memory_refs": self._build_memory_refs(conversation_id, conversation),
            "updated_at": self._iso(conversation.get("updated_at")),
        }

    def _load_or_create_conversation(self, user_id: str, conversation_id: str) -> Dict[str, Any]:
        existing = self.memory_crud.get_agent_chat_conversation(user_id, conversation_id)
        if existing:
            return existing
        return self.memory_crud.upsert_agent_chat_conversation(
            user_id,
            conversation_id,
            {
                "current_step": "persona",
                "active_persona_memory_id": None,
                "active_trending_memory_id": None,
                "active_content_memory_id": None,
                "title": "新的创作对话",
                "persona_summary": "",
            },
        )

    def _load_module_memories(
        self,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        modules = {
            "persona": conversation.get("active_persona_memory_id"),
            "trending": conversation.get("active_trending_memory_id"),
            "content": conversation.get("active_content_memory_id"),
        }
        memories: Dict[str, Optional[Dict[str, Any]]] = {}
        for module, memory_id in modules.items():
            memory = None
            if isinstance(memory_id, str) and memory_id:
                memory = self.memory_crud.get_agent_module_memory(user_id, conversation_id, memory_id)
            memories[module] = memory or self.memory_crud.get_latest_agent_module_memory(user_id, conversation_id, module)
        return memories

    def _selected_memory(
        self,
        user_id: str,
        conversation_id: str,
        memory_id: Optional[str],
        expected_module: str,
    ) -> Optional[Dict[str, Any]]:
        if not memory_id:
            return None
        memory = self.memory_crud.get_agent_module_memory(user_id, conversation_id, memory_id)
        if memory and memory.get("module") == expected_module:
            return memory
        return None

    def _decide_step(self, message: str, requested_step: str, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> AgentStep:
        text = re.sub(r"\s+", "", message.lower())
        if self._matches(text, ("改人设", "换人设", "改定位", "换定位", "重新做人设", "我不是", "账号定位")):
            return "persona"
        if self._matches(text, ("换选题", "再追热点", "追热点", "热门", "趋势", "选题", "推荐选题")):
            return "trending" if module_memories.get("persona") else "persona"
        if self._matches(text, ("写正文", "写内容", "写草稿", "生成草稿", "改标题", "重写开头", "改正文", "润色")):
            if not module_memories.get("persona"):
                return "persona"
            if not module_memories.get("trending"):
                return "trending"
            return "content"

        if not module_memories.get("persona"):
            return "persona"
        if not module_memories.get("trending"):
            return "trending"
        if not module_memories.get("content"):
            return "content"
        if requested_step in {"persona", "trending", "content"}:
            return requested_step  # 用户继续当前模块时允许覆盖已有结果
        return "content"

    def _matches(self, text: str, keywords: tuple[str, ...]) -> bool:
        return any(keyword in text for keyword in keywords)

    def _should_start_new_persona_conversation(
        self,
        message: str,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        selected_persona_id: Optional[str],
    ) -> bool:
        if step != "persona" or not module_memories.get("persona") or selected_persona_id:
            return False
        text = re.sub(r"\s+", "", message.lower())
        return self._matches(
            text,
            (
                "新建角色",
                "新角色",
                "新人设",
                "换人设",
                "换定位",
                "重新做人设",
                "再做一个人设",
                "另一个人设",
                "改成",
            ),
        )

    async def _run_step(
        self,
        *,
        user_id: str,
        message: str,
        step: str,
        conversation_id: str,
        conversation_history: list[Dict[str, str]],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        selected_topic_id: Optional[str],
    ) -> Dict[str, Any]:
        if step == "persona":
            return await self._run_persona(user_id, message, conversation_id, conversation_history, module_memories)
        if step == "trending":
            return await self._run_trending(user_id, message, conversation_id, conversation_history, module_memories)
        if step == "content":
            return await self._run_content(
                user_id,
                message,
                conversation_id,
                conversation_history,
                module_memories,
                selected_topic_id,
            )
        return {
            "reply": "图文指导会在后续接入统一对话。我们先把人设、选题和内容草稿跑顺。",
            "summary_text": "",
            "payload": None,
            "done": False,
            "called_service": None,
        }

    async def _run_persona(
        self,
        user_id: str,
        message: str,
        conversation_id: str,
        conversation_history: list[Dict[str, str]],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        existing = module_memories.get("persona")
        if existing:
            result = await self.persona_service.follow_up(
                user_id,
                self._persona_basic_info(existing.get("payload")),
                message,
                conversation_history=conversation_history,
                conversation_scope_id=conversation_id,
            )
            called_service = "PersonaService.follow_up"
        else:
            result = await self.persona_service.analyze(
                user_id,
                {"selfDescription": message, "goals": ["通过统一对话入口完成人设打造"]},
            )
            called_service = "PersonaService.analyze"

        if result.get("status") == "failed":
            return self._failed_step(result.get("message", "人设生成失败"), called_service)

        data = result.get("data") or {}
        payload = data.get("structuredResult") or data.get("personaDraft") or data
        done = self._has_persona_payload(payload)
        return {
            "reply": self._persona_reply(data, payload),
            "summary_text": self._persona_summary(payload),
            "payload": payload if done else None,
            "done": done,
            "called_service": called_service,
        }

    async def _run_trending(
        self,
        user_id: str,
        message: str,
        conversation_id: str,
        conversation_history: list[Dict[str, str]],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        persona = self._payload(module_memories.get("persona"))
        if not persona:
            return self._failed_step("我们先把人设定下来，再根据人设去追热点和选题。", None)
        result = await self.trend_service.track(
            user_id,
            message,
            persona=persona,
            conversation_history=conversation_history,
            conversation_scope_id=conversation_id,
        )
        called_service = "TrendService.track"
        if result.get("status") == "failed":
            return self._failed_step(result.get("message", "热门追踪失败"), called_service)
        data = result.get("data") or {}
        payload = data.get("completeAnalysis")
        done = isinstance(payload, dict) and bool(payload.get("topics"))
        return {
            "reply": data.get("text") or "我先帮你整理一版热门追踪结果。",
            "summary_text": self._trend_summary(payload),
            "payload": payload if done else None,
            "done": done,
            "called_service": called_service,
        }

    async def _run_content(
        self,
        user_id: str,
        message: str,
        conversation_id: str,
        conversation_history: list[Dict[str, str]],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        selected_topic_id: Optional[str],
    ) -> Dict[str, Any]:
        persona = self._payload(module_memories.get("persona"))
        trending_memory = module_memories.get("trending")
        trending = self._payload(trending_memory)
        if not persona:
            return self._failed_step("我们先把人设定下来，再开始写内容。", None)
        if not trending:
            return self._failed_step("我们先做一版热门追踪或选题，再进入内容撰写。", None)

        current_content = self._payload(module_memories.get("content"))
        is_revision = self._is_revision_message(message) and not self._is_new_content_message(message)
        topic = self._choose_topic(trending, message, selected_topic_id)
        result = await self.content_service.draft(
            user_id,
            topic,
            message,
            conversation_history=conversation_history,
            current_draft=current_content if current_content and is_revision else None,
            revision_instruction=message if current_content and is_revision else None,
            writing_entry_source={
                "sourceType": "unified_agent_chat",
                "conversationId": conversation_id,
                "personaMemoryId": module_memories["persona"]["memory_id"] if module_memories.get("persona") else None,
                "trendingMemoryId": trending_memory["memory_id"] if trending_memory else None,
                "topicId": selected_topic_id,
                "topicTitle": topic,
            },
            persona=persona,
            conversation_scope_id=conversation_id,
        )
        called_service = "ContentService.draft"
        if result.get("status") == "failed":
            return self._failed_step(result.get("message", "内容撰写失败"), called_service)
        data = result.get("data") or {}
        payload = data.get("completeDraft")
        done = isinstance(payload, dict) and bool(payload.get("title"))
        return {
            "reply": data.get("text") or "我先帮你写一版内容草稿。",
            "summary_text": self._content_summary(payload),
            "payload": payload if done else None,
            "done": done,
            "called_service": called_service,
            "parent_refs": {
                "persona_memory_id": module_memories["persona"]["memory_id"] if module_memories.get("persona") else None,
                "trending_memory_id": trending_memory["memory_id"] if trending_memory else None,
            },
        }

    def _active_ids(
        self,
        conversation: Dict[str, Any],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> Dict[str, Optional[str]]:
        return {
            module: memory.get("memory_id") if isinstance(memory, dict) else None
            for module, memory in module_memories.items()
        }

    def _next_step(self, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> str:
        if not module_memories.get("persona"):
            return "persona"
        if not module_memories.get("trending"):
            return "trending"
        if not module_memories.get("content"):
            return "content"
        return "done"

    def _build_summary(
        self,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
    ) -> Dict[str, Dict[str, Any]]:
        summary = {}
        for module in ("persona", "trending", "content"):
            memory_id = conversation.get(f"active_{module}_memory_id")
            memory = (
                self.memory_crud.get_agent_module_memory(user_id, conversation_id, memory_id)
                if isinstance(memory_id, str) and memory_id
                else None
            )
            summary[module] = {
                "done": bool(memory and memory.get("done")),
                "title": SUMMARY_TITLES[module],
                "text": memory.get("summary_text", "") if memory else "",
                "message_id": memory.get("source_message_id") if memory else None,
                "memory_id": memory.get("memory_id") if memory else None,
            }
            if module == "content":
                summary[module]["items"] = self._content_summary_items(user_id, conversation_id, conversation)
        return summary

    def _content_summary_items(
        self,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
    ) -> list[Dict[str, Any]]:
        active_memory_id = conversation.get("active_content_memory_id")
        active_persona_id = conversation.get("active_persona_memory_id")
        active_trending_id = conversation.get("active_trending_memory_id")
        memories = self.memory_crud.list_agent_module_memories(user_id, conversation_id, "content")
        items = []
        for memory in memories:
            parent_refs = memory.get("parent_refs") if isinstance(memory.get("parent_refs"), dict) else {}
            if active_persona_id and parent_refs.get("persona_memory_id") != active_persona_id:
                continue
            if active_trending_id and parent_refs.get("trending_memory_id") != active_trending_id:
                continue
            payload = memory.get("payload") if isinstance(memory.get("payload"), dict) else {}
            item_title = payload.get("title") or memory.get("summary_text") or "内容草稿"
            items.append(
                {
                    "memory_id": memory.get("memory_id"),
                    "title": self._compact(str(item_title), 32),
                    "text": memory.get("summary_text", ""),
                    "message_id": memory.get("source_message_id"),
                    "active": memory.get("memory_id") == active_memory_id,
                    "created_at": self._iso(memory.get("created_at")),
                }
            )
        return items

    def _build_memory_refs(self, conversation_id: str, conversation: Dict[str, Any]) -> Dict[str, Optional[str]]:
        return {
            "conversation_memory_id": f"conv_mem_{conversation_id.removeprefix('conv_')}",
            "persona_memory_id": conversation.get("active_persona_memory_id"),
            "trending_memory_id": conversation.get("active_trending_memory_id"),
            "content_memory_id": conversation.get("active_content_memory_id"),
        }

    def _conversation_title(self, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> str:
        persona_summary = self._conversation_persona_summary(module_memories)
        return persona_summary or "新的创作对话"

    def _conversation_persona_summary(self, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> str:
        persona_memory = module_memories.get("persona")
        if not isinstance(persona_memory, dict):
            return ""
        return self._compact(str(persona_memory.get("summary_text") or ""), 24)

    def _used_memory_blocks(self, step: str, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> list[str]:
        blocks = ["conversation"]
        if step in {"trending", "content"} and module_memories.get("persona"):
            blocks.append("persona")
        if step == "content" and module_memories.get("trending"):
            blocks.append("trending")
        if step == "content" and module_memories.get("content"):
            blocks.append("content")
        return blocks

    def _to_agent_history(self, messages: list[Dict[str, Any]]) -> list[Dict[str, str]]:
        return [
            {"role": message["role"], "content": message["content"]}
            for message in messages
            if message.get("role") in {"user", "assistant"} and message.get("content")
        ][-12:]

    def _payload(self, memory: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        payload = memory.get("payload") if isinstance(memory, dict) else None
        return payload if isinstance(payload, dict) else {}

    def _persona_basic_info(self, payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        basic_info = payload.get("basicInfo")
        if isinstance(basic_info, dict) and basic_info:
            return basic_info
        return {"previousPersona": payload}

    def _persona_reply(self, data: Dict[str, Any], payload: Dict[str, Any]) -> str:
        reply = data.get("reply")
        if isinstance(reply, str) and reply.strip():
            return reply.strip()
        summary = self._persona_summary(payload)
        return f"我们先把人设定下来：{summary}" if summary else "我们先把人设定下来。"

    def _persona_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        persona = payload.get("persona") if isinstance(payload.get("persona"), dict) else {}
        niche = payload.get("niche") if isinstance(payload.get("niche"), dict) else {}
        content_style = payload.get("contentStyle") if isinstance(payload.get("contentStyle"), list) else []
        parts = [
            persona.get("description") or persona.get("name"),
            niche.get("primary"),
            "、".join(str(item) for item in content_style[:2] if isinstance(item, str)),
        ]
        return self._compact("，".join(str(part).strip() for part in parts if part), 80)

    def _trend_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        topics = payload.get("topics") if isinstance(payload.get("topics"), list) else []
        topic_text = "、".join(str(topic) for topic in topics[:2])
        return self._compact("，".join(part for part in [payload.get("trackName"), topic_text] if part), 80)

    def _content_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        return self._compact(str(payload.get("title") or payload.get("intro") or ""), 80)

    def _has_persona_payload(self, payload: Any) -> bool:
        if not isinstance(payload, dict):
            return False
        persona = payload.get("persona")
        niche = payload.get("niche")
        return bool(
            isinstance(persona, dict)
            and any(str(value).strip() for value in persona.values() if isinstance(value, str))
            and isinstance(niche, dict)
            and any(str(value).strip() for value in niche.values() if isinstance(value, str))
        )

    def _choose_topic(self, trending: Dict[str, Any], message: str, selected_topic_id: Optional[str]) -> str:
        topics = trending.get("topics") if isinstance(trending.get("topics"), list) else []
        if selected_topic_id:
            for item in topics:
                if isinstance(item, dict) and item.get("id") == selected_topic_id and item.get("title"):
                    return item["title"]
        if topics:
            first = topics[0]
            if isinstance(first, str):
                return first
            if isinstance(first, dict) and first.get("title"):
                return first["title"]
        return message

    def _is_revision_message(self, message: str) -> bool:
        text = re.sub(r"\s+", "", message)
        return self._matches(text, ("改", "重写", "优化", "润色", "换标题", "改标题", "改正文", "改开头"))

    def _is_new_content_message(self, message: str) -> bool:
        text = re.sub(r"\s+", "", message)
        return self._matches(
            text,
            (
                "再写一篇",
                "新写一篇",
                "换个内容",
                "换一个内容",
                "换一个方向",
                "另一个角度",
                "再来一版",
                "重新写一篇",
                "不要这篇写新的",
                "不要这篇，写新的",
            ),
        )

    def _compact(self, text: str, limit: int) -> str:
        cleaned = re.sub(r"\s+", " ", text or "").strip(" ，,。")
        return cleaned if len(cleaned) <= limit else cleaned[: limit - 1].rstrip(" ，,。") + "…"

    def _failed_step(self, reply: str, called_service: Optional[str]) -> Dict[str, Any]:
        return {
            "reply": reply,
            "summary_text": "",
            "payload": None,
            "done": False,
            "called_service": called_service,
        }

    def _error_response(self, conversation_id: Optional[str], message: str) -> Dict[str, Any]:
        resolved_conversation_id = conversation_id or f"conv_{uuid4().hex[:8]}"
        return {
            "conversation_id": resolved_conversation_id,
            "assistant_message": {
                "id": f"msg_{uuid4().hex[:8]}",
                "role": "assistant",
                "content": message,
                "created_at": datetime.now(CHINA_TZ).isoformat(),
            },
            "current_step": "persona",
            "next_step": "persona",
            "summary": self._empty_summary(),
            "memory_refs": {
                "conversation_memory_id": f"conv_mem_{resolved_conversation_id.removeprefix('conv_')}",
                "persona_memory_id": None,
                "trending_memory_id": None,
                "content_memory_id": None,
            },
        }

    def _empty_summary(self) -> Dict[str, Dict[str, Any]]:
        summary = {
            module: {
                "done": False,
                "title": title,
                "text": "",
                "message_id": None,
                "memory_id": None,
            }
            for module, title in SUMMARY_TITLES.items()
        }
        summary["content"]["items"] = []
        return summary

    def _iso(self, value: Any) -> str:
        if isinstance(value, datetime):
            return value.replace(tzinfo=timezone.utc).astimezone(CHINA_TZ).isoformat()
        return datetime.now(CHINA_TZ).isoformat()
