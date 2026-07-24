from __future__ import annotations

import json
import re
import unicodedata
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Literal, Optional
from uuid import uuid4

from ...database.crud.memory_crud import MemoryCRUD
from ..content import ContentService
from ..persona import PersonaService
from ..trend import TrendService

AgentStep = Literal["persona", "trending", "content", "image_guidance", "done"]
AgentActionType = Literal["message", "quick_reply", "approve_step", "choose_topic", "revise_content", "regenerate", "save"]
CHINA_TZ = timezone(timedelta(hours=8))
PERSONA_ENTRY_PROMPT = (
    "Hi，我是你的顶流小猪梨呀~ 我们先把你这个账号的人设聊清楚，再去做热门追踪，最后写成小红书图文笔记。\n\n"
    "先不用想得很专业，从下面 3 个问题里挑一个回答就行。"
)
TRENDING_ENTRY_PROMPT = "人设已准备好。接下来告诉我你想追的热门方向，比如涨粉赛道、种草方法、经验分享，我来帮你做热门追踪。"
SUMMARY_TITLES = {
    "persona": "人设打造",
    "trending": "热门追踪",
    "content": "内容撰写",
}
INITIAL_PERSONA_QUESTIONS = [
    "你现在是什么身份或阶段？比如学生、职场新人、宝妈、自由职业都可以说",
    "你平时最感兴趣、最愿意聊的爱好是什么？比如美妆、穿搭、游戏、追剧、学习都可以",
    "你觉得自己比较擅长分享什么？比如测评、整理清单、避坑经验、真实日常都可以",
]


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
        action_type: AgentActionType = "message",
        action_payload: Optional[Dict[str, Any]] = None,
        expose_debug: bool = False,
    ) -> Dict[str, Any]:
        clean_message = (message or "").strip()
        action_payload = action_payload or {}
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
        if action_type == "approve_step":
            return self._approve_step(
                user_id=user_id,
                conversation_id=resolved_conversation_id,
                conversation=conversation,
                module_memories=module_memories,
                step=self._valid_step(current_step or previous_step),
                expose_debug=expose_debug,
            )
        if action_type == "save":
            return self._save_active_step(
                user_id=user_id,
                conversation_id=resolved_conversation_id,
                conversation=conversation,
                module_memories=module_memories,
                step=self._valid_step(current_step or previous_step),
                expose_debug=expose_debug,
            )

        if action_type == "choose_topic":
            self._mark_module_done(user_id, resolved_conversation_id, "trending", module_memories)
            conversation = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                resolved_conversation_id,
                {
                    **conversation,
                    "current_step": "content",
                    "active_trending_memory_id": module_memories.get("trending", {}).get("memory_id")
                    if isinstance(module_memories.get("trending"), dict)
                    else conversation.get("active_trending_memory_id"),
                },
            )
            previous_step = "content"
            selected_topic_id = selected_topic_id or self._read_string(action_payload.get("topic_id") or action_payload.get("memory_id"))
            clean_message = self._read_string(action_payload.get("title") or action_payload.get("label")) or clean_message
        elif action_type == "revise_content":
            previous_step = "content"
            clean_message = self._read_string(action_payload.get("instruction") or action_payload.get("label")) or clean_message
        elif action_type == "regenerate":
            clean_message = self._read_string(action_payload.get("instruction") or action_payload.get("label")) or clean_message

        step = self._decide_step(clean_message, current_step or previous_step, module_memories, action_type)
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
        persona_question_context = {
            "history_messages": [*history_before, user_message],
            "shown_persona_question_signatures": self._shown_persona_question_signatures(conversation),
            "shown_persona_questions": self._shown_persona_questions(conversation),
            "shown_persona_question_keys": self._shown_persona_question_keys(conversation),
        }

        handler_result = await self._run_step(
            user_id=user_id,
            message=clean_message,
            step=step,
            conversation_id=resolved_conversation_id,
            conversation_history=conversation_history,
            module_memories=module_memories,
            selected_topic_id=selected_topic_id,
            action_type=action_type,
            action_payload=action_payload,
            persona_question_context=persona_question_context,
        )
        handler_result.update(persona_question_context)
        assistant_content = handler_result["reply"]
        if step == "content" and isinstance(handler_result.get("payload"), dict):
            assistant_content = self._content_display_text(handler_result["payload"]) or assistant_content
        assistant_message = self.memory_crud.save_agent_chat_message(
            user_id=user_id,
            conversation_id=resolved_conversation_id,
            role="assistant",
            content=assistant_content,
            step=step,
        )

        created_memory = None
        if isinstance(handler_result.get("payload"), dict):
            memory_id = handler_result.get("memory_id")
            if action_type == "regenerate" and step in {"persona", "trending"} and isinstance(module_memories.get(step), dict):
                memory_id = module_memories[step].get("memory_id")
            created_memory = self.memory_crud.save_agent_module_memory(
                user_id=user_id,
                conversation_id=resolved_conversation_id,
                module=step,
                title=SUMMARY_TITLES[step],
                summary_text=handler_result["summary_text"],
                payload=handler_result["payload"],
                source_message_id=assistant_message["message_id"],
                done=False,
                memory_id=memory_id,
                parent_refs=handler_result.get("parent_refs"),
            )
            module_memories[step] = created_memory
            if step == "persona":
                module_memories["trending"] = None
                module_memories["content"] = None
            elif step == "trending":
                module_memories["content"] = None

        active_ids = self._active_ids(conversation, module_memories)
        current_state_step = step if step in {"persona", "trending", "content"} else self._next_step(module_memories)

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
        summary = self._build_summary(user_id, resolved_conversation_id, conversation_doc)
        readiness = self._build_readiness(step, module_memories, handler_result)
        question_blocks = self._build_question_blocks(step, module_memories, readiness, handler_result)
        if step == "persona":
            conversation_doc = self._remember_persona_question_blocks(
                user_id,
                resolved_conversation_id,
                conversation_doc,
                question_blocks,
            )
        copy_payload = self._copy_payload_for_step(step, module_memories)
        assistant_message = self._persist_assistant_message_artifacts(
            user_id=user_id,
            conversation_id=resolved_conversation_id,
            assistant_message=assistant_message,
            question_blocks=question_blocks,
            copy_payload=copy_payload,
        )

        response = {
            "conversation_id": resolved_conversation_id,
            "conversation_title": conversation_doc.get("title") or "新的创作对话",
            "assistant_message": {
                "id": assistant_message["message_id"],
                "role": "assistant",
                "content": assistant_content,
                "created_at": self._iso(assistant_message["created_at"]),
                "step": step,
                "question_blocks": assistant_message.get("question_blocks") if isinstance(assistant_message.get("question_blocks"), list) else [],
                "copy_payload": assistant_message.get("copy_payload") if isinstance(assistant_message.get("copy_payload"), dict) else {},
            },
            "current_step": step,
            "next_step": None if current_state_step == "done" else current_state_step,
            "summary": summary,
            "memory_refs": self._build_memory_refs(resolved_conversation_id, conversation_doc),
            "conversation_kind": conversation_doc.get("conversation_kind") or "task",
            "source_persona_record_id": conversation_doc.get("source_persona_record_id"),
            "parent_conversation_id": conversation_doc.get("parent_conversation_id"),
            "actions": self._build_actions(step, module_memories, readiness, handler_result),
            "question_blocks": question_blocks,
            "readiness": readiness,
            "copy_payload": copy_payload,
            "metadata": handler_result.get("metadata", {}) if isinstance(handler_result.get("metadata"), dict) else {},
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
        self.memory_crud.delete_empty_agent_chat_conversations(user_id)
        records = self.memory_crud.list_agent_chat_conversations(user_id, limit=limit)
        conversations = []
        for record in records:
            conversation_id = record.get("conversation_id")
            if not isinstance(conversation_id, str) or not conversation_id:
                continue
            summary = self._build_summary(user_id, conversation_id, record)
            title = record.get("title")
            conversations.append(
                {
                    "conversation_id": conversation_id,
                    "title": title or "新的创作对话",
                    "current_step": record.get("current_step") or "persona",
                    "summary": summary,
                    "memory_refs": self._build_memory_refs(conversation_id, record),
                    "conversation_kind": record.get("conversation_kind") or "task",
                    "create_status": record.get("create_status") or "ready",
                    "source_persona_record_id": record.get("source_persona_record_id"),
                    "parent_conversation_id": record.get("parent_conversation_id"),
                    "updated_at": self._iso(record.get("updated_at")),
                }
            )
        return {"conversations": conversations}

    async def create_conversation(self, *, user_id: str) -> Dict[str, Any]:
        conversation_id = f"conv_{uuid4().hex[:8]}"
        try:
            initial_blocks = self._initial_persona_question_blocks()
            assistant_message = self.memory_crud.save_agent_chat_message(
                user_id=user_id,
                conversation_id=conversation_id,
                role="assistant",
                content=PERSONA_ENTRY_PROMPT,
                step="persona",
                question_blocks=initial_blocks,
            )
            conversation = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {
                    "current_step": "persona",
                    "active_persona_memory_id": None,
                    "active_trending_memory_id": None,
                    "active_content_memory_id": None,
                    "title": "新建对话",
                    "persona_summary": "",
                    "conversation_kind": "draft",
                    "source_persona_record_id": None,
                    "parent_conversation_id": None,
                    "create_status": "ready",
                    "welcome_message_id": assistant_message["message_id"],
                },
            )
            conversation = self._remember_persona_question_blocks(
                user_id,
                conversation_id,
                conversation,
                initial_blocks,
            )
            detail = self.get_conversation(user_id=user_id, conversation_id=conversation["conversation_id"])
            if not detail:
                raise RuntimeError("created conversation cannot be loaded")
            return detail
        except Exception:
            self.memory_crud.delete_agent_chat_conversation(user_id, conversation_id)
            raise

    async def generate_initial_persona_questions(self, *, user_id: str, conversation_id: str) -> None:
        conversation = self.memory_crud.get_agent_chat_conversation(user_id, conversation_id)
        if not conversation or conversation.get("create_status") != "questions_pending":
            return
        try:
            handler_result = await self._run_persona(
                user_id,
                "用户刚开启新对话，还没有提供账号信息。请先生成 3 个真正值得回答的人设问题。",
                conversation_id,
                [],
                {"persona": None, "trending": None, "content": None},
                {
                    "shown_persona_question_signatures": [],
                    "shown_persona_questions": [],
                    "shown_persona_question_keys": [],
                    "history_messages": [],
                },
            )
            if handler_result.get("failed"):
                raise RuntimeError(handler_result.get("reply") or "persona questions cannot be generated")
            initial_blocks = self._build_question_blocks(
                "persona",
                {},
                {"persona": "needs_more_info"},
                handler_result,
            )
            if len(initial_blocks) != 3:
                raise RuntimeError("persona question blocks must contain exactly 3 questions")

            messages = self.memory_crud.list_agent_chat_messages(user_id, conversation_id)
            if any(message.get("role") == "user" for message in messages if isinstance(message, dict)):
                self.memory_crud.upsert_agent_chat_conversation(
                    user_id,
                    conversation_id,
                    {**conversation, "create_status": "ready"},
                )
                return

            conversation = self._remember_persona_question_blocks(
                user_id,
                conversation_id,
                conversation,
                initial_blocks,
            )
            welcome_message_id = self._read_string(conversation.get("welcome_message_id"))
            if welcome_message_id:
                updater = getattr(self.memory_crud, "update_agent_chat_message", None)
                if callable(updater):
                    updater(user_id, conversation_id, welcome_message_id, {"question_blocks": initial_blocks})
            self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {**conversation, "create_status": "ready"},
            )
        except Exception:
            latest = self.memory_crud.get_agent_chat_conversation(user_id, conversation_id) or conversation
            self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {**latest, "create_status": "questions_failed"},
            )

    def get_conversation(self, *, user_id: str, conversation_id: str) -> Optional[Dict[str, Any]]:
        conversation = self.memory_crud.get_agent_chat_conversation(user_id, conversation_id)
        if not conversation:
            return None
        current_step = conversation.get("current_step") or "persona"
        module_memories = self._load_module_memories(user_id, conversation_id, conversation)
        readiness = self._build_readiness(current_step, module_memories, {})
        summary = self._build_summary(user_id, conversation_id, conversation)
        conversation_title = conversation.get("title")
        raw_messages = self.memory_crud.list_agent_chat_messages(user_id, conversation_id)
        history_context = {
            "history_messages": raw_messages,
            "shown_persona_question_signatures": self._shown_persona_question_signatures(conversation),
            "shown_persona_questions": self._shown_persona_questions(conversation),
            "shown_persona_question_keys": self._shown_persona_question_keys(conversation),
        }
        has_user_history = any(message.get("role") == "user" for message in raw_messages if isinstance(message, dict))
        question_blocks = (
            self._current_persona_question_blocks(conversation)
            if current_step == "persona" and readiness.get("persona") != "ready_for_approval" and not has_user_history
            else []
        )
        if (
            not question_blocks
            and current_step == "persona"
            and not has_user_history
            and conversation.get("create_status") == "questions_pending"
        ):
            question_blocks = self._initial_persona_question_blocks()
            conversation = self._remember_persona_question_blocks(
                user_id,
                conversation_id,
                conversation,
                question_blocks,
            )
            welcome_message_id = self._read_string(conversation.get("welcome_message_id"))
            if welcome_message_id:
                updater = getattr(self.memory_crud, "update_agent_chat_message", None)
                if callable(updater):
                    updater(user_id, conversation_id, welcome_message_id, {"question_blocks": question_blocks})
                    raw_messages = self.memory_crud.list_agent_chat_messages(user_id, conversation_id)
            conversation = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {**conversation, "create_status": "ready"},
            )
        if not question_blocks:
            question_blocks = self._build_question_blocks(current_step, module_memories, readiness, history_context)
        messages = [
            {
                "id": message["message_id"],
                "role": message["role"],
                "content": message["content"],
                "step": message.get("step"),
                "created_at": self._iso(message.get("created_at")),
                "question_blocks": message.get("question_blocks") if isinstance(message.get("question_blocks"), list) else [],
                "copy_payload": message.get("copy_payload") if isinstance(message.get("copy_payload"), dict) else {},
            }
            for message in raw_messages
            if message.get("message_id") and message.get("role") in {"user", "assistant"}
        ]
        if question_blocks:
            for message in reversed(messages):
                if message["role"] == "assistant" and not message.get("question_blocks"):
                    message["question_blocks"] = question_blocks
                    break
        return {
            "conversation_id": conversation_id,
            "conversation_title": conversation_title or "新的创作对话",
            "current_step": current_step,
            "messages": messages,
            "summary": summary,
            "memory_refs": self._build_memory_refs(conversation_id, conversation),
            "conversation_kind": conversation.get("conversation_kind") or "task",
            "create_status": conversation.get("create_status") or "ready",
            "source_persona_record_id": conversation.get("source_persona_record_id"),
            "parent_conversation_id": conversation.get("parent_conversation_id"),
            "actions": self._build_actions(current_step, module_memories, readiness, {}),
            "question_blocks": question_blocks,
            "readiness": readiness,
            "copy_payload": self._copy_payload_for_step(current_step, module_memories),
            "updated_at": self._iso(conversation.get("updated_at")),
        }

    def delete_conversation(self, *, user_id: str, conversation_id: str) -> Dict[str, Any]:
        deleted = self.memory_crud.delete_agent_chat_conversation(user_id, conversation_id)
        return {"code": 200, "data": {"deleted": deleted, "conversation_id": conversation_id}}

    def start_conversation_from_persona(self, *, user_id: str, persona_record_id: str) -> Optional[Dict[str, Any]]:
        record = self.persona_service.get_persona_record(user_id, persona_record_id)
        persona_payload = record.get("persona") if isinstance(record, dict) else None
        if not isinstance(persona_payload, dict) or not persona_payload:
            return None

        conversation_id = f"conv_{uuid4().hex[:8]}"
        parent_conversation_id = self._find_persona_project_root_id(user_id, persona_record_id)
        assistant_message = self.memory_crud.save_agent_chat_message(
            user_id=user_id,
            conversation_id=conversation_id,
            role="assistant",
            content=TRENDING_ENTRY_PROMPT,
            step="trending",
        )
        persona_memory = self.memory_crud.save_agent_module_memory(
            user_id=user_id,
            conversation_id=conversation_id,
            module="persona",
            title=SUMMARY_TITLES["persona"],
            summary_text=self._persona_summary(persona_payload) or self._compact(str(persona_payload.get("title") or "已保存人设"), 24),
            payload=persona_payload,
            source_message_id=assistant_message["message_id"],
            done=True,
        )
        conversation = self.memory_crud.upsert_agent_chat_conversation(
            user_id,
            conversation_id,
            {
                "current_step": "trending",
                "active_persona_memory_id": persona_memory["memory_id"],
                "active_trending_memory_id": None,
                "active_content_memory_id": None,
                "title": self._persona_summary(persona_payload) or self._compact(str(persona_payload.get("title") or "已保存人设"), 24),
                "persona_summary": self._persona_summary(persona_payload),
                "conversation_kind": "task",
                "source_persona_record_id": persona_record_id,
                "parent_conversation_id": parent_conversation_id,
            },
        )
        return self.get_conversation(user_id=user_id, conversation_id=conversation["conversation_id"])

    def _find_persona_project_root_id(self, user_id: str, persona_record_id: str) -> Optional[str]:
        conversations = self.memory_crud.list_agent_chat_conversations(user_id, limit=200)
        for conversation in conversations:
            conversation_id = self._read_string(conversation.get("conversation_id"))
            if (
                conversation.get("source_persona_record_id") == persona_record_id
                and conversation.get("parent_conversation_id") == conversation_id
            ):
                return conversation_id
        return None

    def _approve_step(
        self,
        *,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        step: AgentStep,
        expose_debug: bool = False,
    ) -> Dict[str, Any]:
        if step not in {"persona", "trending", "content"}:
            return self._error_response(conversation_id, "当前阶段不能确认。")
        approved_memory = self._mark_module_done(user_id, conversation_id, step, module_memories)
        if not approved_memory:
            return self._error_response(conversation_id, "还没有可确认的结果，请先生成一轮内容。")

        next_step = self._next_step_after_approval(step)
        reply_content = self._approval_reply(step)
        assistant_message = None
        if step != "content":
            assistant_message = self.memory_crud.save_agent_chat_message(
                user_id=user_id,
                conversation_id=conversation_id,
                role="assistant",
                content=reply_content,
                step=step,
            )
        conversation_doc = self.memory_crud.upsert_agent_chat_conversation(
            user_id,
            conversation_id,
            {
                **conversation,
                "current_step": next_step,
                "active_persona_memory_id": module_memories.get("persona", {}).get("memory_id")
                if isinstance(module_memories.get("persona"), dict)
                else conversation.get("active_persona_memory_id"),
                "active_trending_memory_id": module_memories.get("trending", {}).get("memory_id")
                if isinstance(module_memories.get("trending"), dict)
                else conversation.get("active_trending_memory_id"),
                "active_content_memory_id": module_memories.get("content", {}).get("memory_id")
                if isinstance(module_memories.get("content"), dict)
                else conversation.get("active_content_memory_id"),
                "title": self._conversation_title(module_memories),
                "persona_summary": self._conversation_persona_summary(module_memories),
            },
        )
        readiness = self._build_readiness(next_step, module_memories, {})
        response = {
            "conversation_id": conversation_id,
            "conversation_title": conversation_doc.get("title") or "新的创作对话",
            "assistant_message": {
                "id": assistant_message["message_id"],
                "role": "assistant",
                "content": assistant_message["content"],
                "created_at": self._iso(assistant_message["created_at"]),
            } if assistant_message else None,
            "current_step": step,
            "next_step": None if next_step == "done" else next_step,
            "summary": self._build_summary(user_id, conversation_id, conversation_doc),
            "memory_refs": self._build_memory_refs(conversation_id, conversation_doc),
            "conversation_kind": conversation_doc.get("conversation_kind") or "task",
            "source_persona_record_id": conversation_doc.get("source_persona_record_id"),
            "parent_conversation_id": conversation_doc.get("parent_conversation_id"),
            "actions": self._build_actions(next_step, module_memories, readiness, {}),
            "question_blocks": self._build_question_blocks(next_step, module_memories, readiness, {}),
            "readiness": readiness,
            "copy_payload": self._copy_payload_for_step(step, module_memories),
        }
        if expose_debug:
            response["debug"] = {"action": "approve_step", "approved_memory_id": approved_memory.get("memory_id")}
        return response

    def _save_active_step(
        self,
        *,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        step: AgentStep,
        expose_debug: bool = False,
    ) -> Dict[str, Any]:
        if step not in {"persona", "trending", "content"}:
            return self._error_response(conversation_id, "当前阶段没有可保存内容。")
        memory = module_memories.get(step)
        if not isinstance(memory, dict):
            return self._error_response(conversation_id, "还没有可保存的结果。")
        payload = self._payload(memory)
        save_result = (
            {"status": "success", "data": payload}
            if step == "trending"
            else self._save_module_payload(user_id, step, payload)
        )
        status_ok = save_result.get("status") == "success"
        saved_record = save_result.get("record") if isinstance(save_result.get("record"), dict) else {}
        saved_persona_record_id = self._read_string(saved_record.get("id") or saved_record.get("personaRecordId"))
        reply_content = self._save_reply(step, status_ok)
        assistant_message = None
        if not (status_ok and step == "content"):
            assistant_message = self.memory_crud.save_agent_chat_message(
                user_id=user_id,
                conversation_id=conversation_id,
                role="assistant",
                content=reply_content,
                step=step,
            )
        response_step = step
        conversation_doc = conversation
        if status_ok and step == "persona":
            self._mark_module_done(user_id, conversation_id, step, module_memories)
            active_ids = self._active_ids(conversation, module_memories)
            conversation_doc = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {
                    **conversation,
                    "current_step": "trending",
                    "active_persona_memory_id": active_ids.get("persona"),
                    "active_trending_memory_id": None,
                    "active_content_memory_id": None,
                    "title": self._conversation_title(module_memories),
                    "persona_summary": self._conversation_persona_summary(module_memories),
                    "conversation_kind": "task",
                    "source_persona_record_id": saved_persona_record_id or conversation.get("source_persona_record_id"),
                    "parent_conversation_id": conversation_id,
                },
            )
            response_step = "trending"
        elif status_ok and step == "trending":
            self._mark_module_done(user_id, conversation_id, step, module_memories)
            active_ids = self._active_ids(conversation, module_memories)
            conversation_doc = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {
                    **conversation,
                    "current_step": "content",
                    "active_persona_memory_id": active_ids.get("persona"),
                    "active_trending_memory_id": active_ids.get("trending"),
                    "active_content_memory_id": None,
                    "title": self._saved_conversation_title(step, module_memories),
                    "persona_summary": self._conversation_persona_summary(module_memories),
                },
            )
            response_step = "content"
        elif status_ok and step == "content":
            self._mark_module_done(user_id, conversation_id, step, module_memories)
            active_ids = self._active_ids(conversation, module_memories)
            conversation_doc = self.memory_crud.upsert_agent_chat_conversation(
                user_id,
                conversation_id,
                {
                    **conversation,
                    "current_step": "done",
                    "active_persona_memory_id": active_ids.get("persona"),
                    "active_trending_memory_id": active_ids.get("trending"),
                    "active_content_memory_id": active_ids.get("content"),
                    "title": self._saved_conversation_title(step, module_memories),
                    "persona_summary": self._conversation_persona_summary(module_memories),
                },
            )
            response_step = "done"
        readiness = self._build_readiness(response_step, module_memories, {})
        response = {
            "conversation_id": conversation_id,
            "conversation_title": conversation_doc.get("title") or "新的创作对话",
            "assistant_message": {
                "id": assistant_message["message_id"],
                "role": "assistant",
                "content": assistant_message["content"],
                "created_at": self._iso(assistant_message["created_at"]),
            } if assistant_message else None,
            "current_step": step,
            "next_step": None if conversation_doc.get("current_step") == "done" else conversation_doc.get("current_step") or response_step,
            "summary": self._build_summary(user_id, conversation_id, conversation_doc),
            "memory_refs": self._build_memory_refs(conversation_id, conversation_doc),
            "conversation_kind": conversation_doc.get("conversation_kind") or "task",
            "source_persona_record_id": conversation_doc.get("source_persona_record_id"),
            "parent_conversation_id": conversation_doc.get("parent_conversation_id"),
            "actions": self._build_actions(response_step, module_memories, readiness, {}),
            "question_blocks": self._build_question_blocks(response_step, module_memories, readiness, {}),
            "readiness": readiness,
            "copy_payload": self._copy_payload_for_step(step, module_memories),
        }
        if saved_persona_record_id:
            response["saved_persona_record_id"] = saved_persona_record_id
        if expose_debug:
            response["debug"] = {"action": "save", "save_result": save_result}
        return response

    def _mark_module_done(
        self,
        user_id: str,
        conversation_id: str,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> Optional[Dict[str, Any]]:
        memory = module_memories.get(step)
        if not isinstance(memory, dict):
            return None
        payload = self._payload(memory)
        updated = self.memory_crud.save_agent_module_memory(
            user_id=user_id,
            conversation_id=conversation_id,
            module=step,
            title=memory.get("title") or SUMMARY_TITLES.get(step, step),
            summary_text=memory.get("summary_text") or self._summary_for_payload(step, payload),
            payload=payload,
            source_message_id=memory.get("source_message_id") or "",
            done=True,
            memory_id=memory.get("memory_id"),
            parent_refs=memory.get("parent_refs"),
        )
        module_memories[step] = updated
        return updated

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
                "conversation_kind": "draft",
                "source_persona_record_id": None,
                "parent_conversation_id": None,
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

    def _decide_step(
        self,
        message: str,
        requested_step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        action_type: AgentActionType = "message",
    ) -> AgentStep:
        requested_step = self._valid_step(requested_step)
        if action_type == "choose_topic":
            return "content"
        if action_type == "revise_content":
            return "content"
        if action_type in {"quick_reply", "regenerate"} and requested_step in {"persona", "trending", "content"}:
            return requested_step
        text = re.sub(r"\s+", "", message.lower())
        if self._matches(text, ("改人设", "换人设", "改定位", "换定位", "重新做人设", "我不是", "账号定位")):
            return "persona"
        if requested_step == "persona" and not self._memory_done(module_memories.get("persona")):
            return "persona"
        if self._matches(text, ("换选题", "再追热点", "追热点", "热门", "趋势", "选题", "推荐选题")):
            return "trending" if self._memory_done(module_memories.get("persona")) else "persona"
        if self._matches(text, ("写正文", "写内容", "写草稿", "生成草稿", "改标题", "重写开头", "改正文", "润色")):
            if not module_memories.get("persona"):
                return "persona"
            if not module_memories.get("trending"):
                return "trending"
            return "content"
        if requested_step in {"persona", "trending", "content"}:
            active_memory = module_memories.get(requested_step)
            if not isinstance(active_memory, dict) or not active_memory.get("done"):
                return requested_step

        if not module_memories.get("persona"):
            return "persona"
        if not module_memories.get("trending"):
            return "trending"
        if not module_memories.get("content"):
            return "content"
        if requested_step in {"persona", "trending", "content"}:
            return requested_step  # 用户继续当前模块时允许覆盖已有结果
        return "content"

    def _valid_step(self, step: Optional[str]) -> AgentStep:
        return step if step in {"persona", "trending", "content", "image_guidance", "done"} else "persona"

    def _matches(self, text: str, keywords: tuple[str, ...]) -> bool:
        return any(keyword in text for keyword in keywords)

    def _has_off_persona_question(self, questions: list[str], context_text: str) -> bool:
        context = (context_text or "").lower()
        if not self._matches(context, ("短剧", "追剧", "爽剧", "影视", "小说", "修仙", "仙侠", "网文", "剧评", "吐槽")):
            return False
        off_track_keywords = ("穿搭", "衣服", "服装", "ootd", "妆容", "美妆", "护肤", "通勤穿", "搭配风格")
        return any(self._matches((question or "").lower(), off_track_keywords) for question in questions)

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
        action_type: AgentActionType = "message",
        action_payload: Optional[Dict[str, Any]] = None,
        persona_question_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if step == "persona":
            return await self._run_persona(
                user_id,
                message,
                conversation_id,
                conversation_history,
                module_memories,
                persona_question_context or {},
            )
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
                action_type,
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
        question_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        existing = module_memories.get("persona")
        question_context = question_context or {}
        prompt_override = self._persona_question_prompt_override(message, question_context, None)
        called_service = "PersonaService.follow_up" if existing else "PersonaService.analyze"
        existing_payload = self._payload(existing) if isinstance(existing, dict) else {}
        last_reasons: list[str] = []
        last_payload: Dict[str, Any] = {}

        for attempt in range(3):
            if existing:
                result = await self.persona_service.follow_up(
                    user_id,
                    self._persona_basic_info(existing.get("payload")),
                    message,
                    conversation_history=conversation_history,
                    conversation_scope_id=conversation_id,
                    prompt_override=prompt_override,
                )
            else:
                result = await self.persona_service.analyze(
                    user_id,
                    {"selfDescription": message, "goals": ["通过统一对话入口完成人设打造"]},
                    prompt_override=prompt_override,
                )

            if result.get("status") == "failed":
                return self._failed_step(result.get("message", "人设生成失败"), called_service)

            data = result.get("data") or {}
            payload = data.get("structuredResult") or data.get("personaDraft") or data
            payload = self._merge_persona_follow_up_payload(existing_payload, payload, message)
            if isinstance(payload, dict) and self._persona_copy_text(payload):
                last_payload = payload
            raw_questions = self._extract_persona_questions(data, payload)
            questions, reasons = self._validate_persona_agent_questions(raw_questions, payload, question_context)
            done = self._has_persona_payload(payload)
            agent_ready = bool(data.get("isReadyToSave") or (isinstance(payload, dict) and payload.get("isReadyToSave")))
            if len(questions) == 3:
                return {
                    "reply": self._persona_reply(data, payload),
                    "summary_text": self._persona_summary(payload),
                    "payload": payload if done or self._persona_copy_text(payload) else None,
                    "done": done,
                    "readiness": "ready_for_approval" if agent_ready else "needs_more_info",
                    "questions": questions,
                    "called_service": called_service,
                }
            last_reasons = reasons or ["persona_question_gate_failed"]
            prompt_override = self._persona_question_prompt_override(message, question_context, last_reasons)

        recovery_questions = self._persona_recovery_questions(message, question_context, module_memories)
        recovery_payload = last_payload if self._persona_copy_text(last_payload) else existing_payload
        return {
            "reply": self._persona_recovery_reply(
                message,
                question_context,
                last_reasons,
                recovery_payload,
            ),
            "summary_text": self._persona_summary(recovery_payload),
            "payload": recovery_payload if self._has_persona_payload(recovery_payload) else None,
            "done": False,
            "readiness": "needs_more_info",
            "questions": recovery_questions,
            "called_service": called_service,
            "metadata": {
                "recovery": {
                    "action": "safe_persona_question_recovery",
                    "reason": "; ".join(last_reasons),
                    "questionCount": len(recovery_questions),
                },
                "qualityChecks": {
                    "personaQuestionCount": len(recovery_questions),
                    "agentQuestionGate": "recovered_after_retry",
                    "repeatedQuestionCheck": "applied",
                },
            },
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
        preference = self._strip_refine_direction_prefix(message)
        existing_trending = self._payload(module_memories.get("trending"))
        force_progress_summary = bool(existing_trending) or preference != message
        result = await self.trend_service.track(
            user_id,
            preference,
            persona=persona,
            conversation_history=conversation_history,
            summary_source_conversation=conversation_history if force_progress_summary else None,
            summary_mode="realtime_progress" if force_progress_summary else None,
            conversation_scope_id=conversation_id,
        )
        called_service = "TrendService.track"
        if result.get("status") == "failed":
            return self._failed_step(result.get("message", "热门追踪失败"), called_service)
        data = result.get("data") or {}
        payload = data.get("completeAnalysis")
        if not isinstance(payload, dict) and existing_trending:
            payload = existing_trending
        if isinstance(payload, dict) and preference:
            if not self._read_string(payload.get("trackName")):
                payload["trackName"] = self._compact(preference, 24)
        done = isinstance(payload, dict) and len(self._trend_titles(payload)) >= 3
        return {
            "reply": self._trend_reply(data, payload),
            "summary_text": self._trend_summary(payload),
            "payload": payload if done else None,
            "done": done,
            "called_service": called_service,
        }

    def _strip_refine_direction_prefix(self, message: str) -> str:
        cleaned = (message or "").strip()
        prefix = "请输入你想继续了解的方向："
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()
        return cleaned or message

    async def _run_content(
        self,
        user_id: str,
        message: str,
        conversation_id: str,
        conversation_history: list[Dict[str, str]],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        selected_topic_id: Optional[str],
        action_type: AgentActionType = "message",
    ) -> Dict[str, Any]:
        persona = self._payload(module_memories.get("persona"))
        trending_memory = module_memories.get("trending")
        trending = self._payload(trending_memory)
        if not persona:
            return self._failed_step("我们先把人设定下来，再开始写内容。", None)
        if not trending:
            return self._failed_step("我们先做一版热门追踪或选题，再进入内容撰写。", None)

        current_content = self._payload(module_memories.get("content"))
        is_revision = (
            action_type == "revise_content"
            or (self._is_revision_message(message) and not self._is_new_content_message(message) and action_type != "regenerate")
        )
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
        done = isinstance(payload, dict) and bool(self._content_publish_text(payload))
        suggestions = data.get("suggestions") if isinstance(data.get("suggestions"), list) else []
        complete_payload = {**payload, "suggestions": suggestions} if done and isinstance(payload, dict) else payload
        return {
            "reply": data.get("text") or "我先帮你写一版内容草稿。",
            "summary_text": self._content_summary(payload),
            "payload": complete_payload if done else None,
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
        if not self._memory_done(module_memories.get("persona")):
            return "persona"
        if not self._memory_done(module_memories.get("trending")):
            return "trending"
        if not self._memory_done(module_memories.get("content")):
            return "content"
        return "done"

    def _memory_done(self, memory: Optional[Dict[str, Any]]) -> bool:
        return bool(isinstance(memory, dict) and memory.get("done"))

    def _next_step_after_approval(self, step: AgentStep) -> AgentStep:
        if step == "persona":
            return "trending"
        if step == "trending":
            return "content"
        if step == "content":
            return "done"
        return step

    def _approval_reply(self, step: AgentStep) -> str:
        if step == "persona":
            return "好，当前人设已确认。接下来告诉我你想追的热门方向，比如涨粉赛道、种草方法、经验分享，我来帮你做热门追踪。"
        if step == "trending":
            return "好，选题方向已确认。接下来我会把它写成小红书图文笔记，包含标题、封面文案、正文、配图建议和标签。"
        if step == "content":
            return "好，这版内容已确认。你可以复制发布文案，也可以继续让我改标题、开头、正文语气或标签。"
        return "已确认。"

    def _save_reply(self, step: AgentStep, success: bool) -> str:
        if not success:
            return "保存失败了，稍后再试一次。"
        if step == "persona":
            return "人设打造完毕。接下来我们就进入热门追踪，你可以直接告诉我想追的热门方向，比如涨粉赛道、种草方法、经验分享，我会帮你把热点、受众需求和可写选题一起整理出来。"
        if step == "trending":
            return "当前热门追踪已确认。你可以从下面 3 个可写题材里选一个，我会直接进入内容撰写；也可以继续告诉我想缩小或换一个方向。"
        if step == "content":
            return "内容撰写已保存。你可以先留着这一版继续修改，也可以让我帮你把标题、开头、正文语气或结尾互动再磨一轮。"
        return "已保存。"

    def _build_readiness(
        self,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        handler_result: Dict[str, Any],
    ) -> Dict[str, str]:
        persona_memory = module_memories.get("persona")
        trending_memory = module_memories.get("trending")
        content_memory = module_memories.get("content")
        persona_ready = self._persona_ready(self._payload(persona_memory), handler_result)
        trending_ready = self._trend_titles(self._payload(trending_memory))
        content_ready = self._content_publish_text(self._payload(content_memory))
        return {
            "persona": "ready_for_approval" if persona_ready else "needs_more_info",
            "trending": "ready_for_content" if len(trending_ready) >= 3 else "needs_more_info",
            "content": "ready_for_approval" if content_ready else "needs_more_info",
        }

    def _build_actions(
        self,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        readiness: Dict[str, str],
        handler_result: Dict[str, Any],
    ) -> list[Dict[str, Any]]:
        if step == "persona":
            if readiness.get("persona") == "ready_for_approval":
                return [
                    self._action("approve_step", "满意，进入热门追踪", "满意，进入热门追踪", {"step": "persona"}),
                    self._action("quick_reply", "继续完善", "继续完善人设", {"step": "persona"}),
                ]
            return []

        if step == "trending":
            titles = self._trend_titles(self._payload(module_memories.get("trending")))
            actions = []
            if titles:
                actions.append(self._action("quick_reply", "继续完善", "继续完善热门追踪", {"step": "trending"}))
            return actions

        if step == "content":
            actions = [
                self._action("revise_content", label, label, {"step": "content", "instruction": label})
                for label in self._content_revision_actions(self._payload(module_memories.get("content")))
            ]
            if readiness.get("content") == "ready_for_approval":
                actions.insert(0, self._action("approve_step", "满意，完成", "满意，完成", {"step": "content"}))
            return actions

        return []

    def _build_question_blocks(
        self,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
        readiness: Dict[str, str],
        handler_result: Dict[str, Any],
    ) -> list[Dict[str, Any]]:
        if step == "trending":
            return self._build_topic_blocks(module_memories)
        if step != "persona":
            return []
        payload = self._payload(module_memories.get("persona"))
        direct_questions = handler_result.get("questions")
        questions = (
            [str(item).strip() for item in direct_questions if isinstance(item, str) and item.strip()][:3]
            if isinstance(direct_questions, list) and len(direct_questions) >= 3
            else self._persona_questions(payload, handler_result)
        )
        context_text = self._persona_context_text(payload, handler_result, questions)
        blocks: list[Dict[str, Any]] = []
        for index, question in enumerate(questions[:3], 1):
            stable_suffix = re.sub(r"\W+", "_", question).strip("_")[:24] or str(index)
            blocks.append(
                {
                    "id": f"persona_question_{index}_{stable_suffix}",
                    "question": question,
                    "examples": [],
                    "prefill_text": f"{question}:",
                    "action_payload": {"step": "persona", "question": question},
                }
            )
        return blocks

    def _initial_persona_question_blocks(self) -> list[Dict[str, Any]]:
        return [
            {
                "id": f"persona_starter_{index}",
                "question": question,
                "examples": [],
                "prefill_text": f"{question}:",
                "action_payload": {"step": "persona", "question": question},
            }
            for index, question in enumerate(INITIAL_PERSONA_QUESTIONS, 1)
        ]

    def _current_persona_question_blocks(self, conversation: Dict[str, Any]) -> list[Dict[str, Any]]:
        blocks = conversation.get("current_persona_question_blocks")
        return blocks if isinstance(blocks, list) else []

    def _shown_persona_questions(self, conversation: Dict[str, Any]) -> list[str]:
        questions = conversation.get("shown_persona_questions")
        result = [str(item) for item in questions if isinstance(item, str)] if isinstance(questions, list) else []
        for block in self._current_persona_question_blocks(conversation):
            if isinstance(block, dict) and isinstance(block.get("question"), str):
                result.append(block["question"])
        return result[-80:]

    def _shown_persona_question_signatures(self, conversation: Dict[str, Any]) -> list[str]:
        signatures = conversation.get("shown_persona_question_signatures")
        result = [str(item) for item in signatures if isinstance(item, str)] if isinstance(signatures, list) else []
        seen = set(result)
        for question in self._shown_persona_questions(conversation):
            signature = self._question_signature(question)
            if signature and signature not in seen:
                result.append(signature)
                seen.add(signature)
        return result[-80:]

    def _shown_persona_question_keys(self, conversation: Dict[str, Any]) -> list[str]:
        keys = conversation.get("shown_persona_question_keys")
        result = [str(item) for item in keys if isinstance(item, str)] if isinstance(keys, list) else []
        seen = set(result)
        for question in self._shown_persona_questions(conversation):
            semantic_key = self._persona_question_semantic_key(question)
            if semantic_key and semantic_key not in seen:
                result.append(semantic_key)
                seen.add(semantic_key)
        return result[-80:]

    def _remember_persona_question_blocks(
        self,
        user_id: str,
        conversation_id: str,
        conversation: Dict[str, Any],
        question_blocks: list[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not question_blocks:
            return conversation
        signatures = self._shown_persona_question_signatures(conversation)
        seen = set(signatures)
        questions = self._shown_persona_questions(conversation)
        semantic_keys = self._shown_persona_question_keys(conversation)
        seen_questions = {self._question_signature(item) for item in questions}
        seen_keys = set(semantic_keys)
        for block in question_blocks:
            if not isinstance(block, dict):
                continue
            question = str(block.get("question") or "")
            signature = self._question_signature(question)
            if signature and signature not in seen:
                signatures.append(signature)
                seen.add(signature)
            if signature and signature not in seen_questions:
                questions.append(question)
                seen_questions.add(signature)
            semantic_key = self._persona_question_semantic_key(question)
            if semantic_key and semantic_key not in seen_keys:
                semantic_keys.append(semantic_key)
                seen_keys.add(semantic_key)
        return self.memory_crud.upsert_agent_chat_conversation(
            user_id,
            conversation_id,
            {
                **conversation,
                "shown_persona_question_signatures": signatures[-80:],
                "shown_persona_questions": questions[-80:],
                "shown_persona_question_keys": semantic_keys[-80:],
                "current_persona_question_blocks": question_blocks,
            },
        )

    def _persist_assistant_message_artifacts(
        self,
        *,
        user_id: str,
        conversation_id: str,
        assistant_message: Dict[str, Any],
        question_blocks: list[Dict[str, Any]],
        copy_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        message_id = self._read_string(assistant_message.get("message_id"))
        if not message_id:
            return assistant_message
        payload: Dict[str, Any] = {}
        if question_blocks:
            payload["question_blocks"] = question_blocks
        if copy_payload:
            payload["copy_payload"] = copy_payload
        if not payload:
            return assistant_message
        updater = getattr(self.memory_crud, "update_agent_chat_message", None)
        if callable(updater):
            updated = updater(user_id, conversation_id, message_id, payload)
            if isinstance(updated, dict) and updated:
                return updated
        assistant_message.update(payload)
        return assistant_message

    def _build_topic_blocks(self, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> list[Dict[str, Any]]:
        trending = self._payload(module_memories.get("trending"))
        titles = self._trend_titles(trending)
        if not titles:
            return []
        blocks: list[Dict[str, Any]] = []
        raw_topics = trending.get("topics") if isinstance(trending.get("topics"), list) else []
        for index, title in enumerate(titles[:3], 1):
            topic_id = None
            for item in raw_topics:
                if isinstance(item, dict) and item.get("title") == title:
                    topic_id = self._read_string(item.get("id") or item.get("topic_id"))
                    break
            stable_suffix = re.sub(r"\W+", "_", title).strip("_")[:24] or str(index)
            blocks.append(
                {
                    "id": f"trending_topic_{index}_{stable_suffix}",
                    "question": title,
                    "examples": [],
                    "prefill_text": title,
                    "action_payload": {"step": "trending", "title": title, "topic_id": topic_id},
                    "action_type": "choose_topic",
                }
            )
        return blocks

    def _action(self, action_type: str, label: str, message: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        action_payload = payload or {}
        stable_suffix = re.sub(r"\W+", "_", label).strip("_")[:24] or "action"
        return {
            "id": f"{action_type}_{stable_suffix}",
            "action_type": action_type,
            "action_payload": action_payload,
            "type": action_type,
            "label": self._compact(label, 34),
            "message": message,
            "payload": action_payload,
        }

    def _persona_questions(self, payload: Dict[str, Any], handler_result: Dict[str, Any]) -> list[str]:
        candidates = handler_result.get("questions")
        if not isinstance(candidates, list):
            raw = payload.get("followUpQuestions") or payload.get("nextQuestions")
            if not isinstance(raw, list):
                draft = payload.get("personaDraft") if isinstance(payload.get("personaDraft"), dict) else {}
                raw = draft.get("followUpQuestions") or draft.get("nextQuestions")
            candidates = raw if isinstance(raw, list) else []
        answered_dimensions = self._answered_persona_dimensions(payload, handler_result)
        asked_signatures = self._asked_question_signatures(handler_result)
        asked_keys = self._asked_persona_question_keys(handler_result)
        questions = self._filter_persona_questions(candidates, answered_dimensions, asked_signatures, asked_keys)
        merged: list[str] = []
        used_layers: set[str] = set()
        for question in questions:
            cleaned = self._compact(question, 42)
            signature = self._question_signature(cleaned)
            layer = self._persona_question_layer(cleaned)
            semantic_key = self._persona_question_semantic_key(cleaned)
            if not signature or signature in asked_signatures:
                continue
            if semantic_key and semantic_key in asked_keys:
                continue
            if layer and layer in used_layers:
                continue
            if self._is_answered_starter_question(cleaned, answered_dimensions):
                continue
            if cleaned and signature not in {self._question_signature(item) for item in merged}:
                merged.append(cleaned)
                if semantic_key:
                    asked_keys.add(semantic_key)
                if layer:
                    used_layers.add(layer)
            if len(merged) >= 3:
                break
        return merged[:3]

    def _persona_question_prompt_override(
        self,
        latest_message: str,
        question_context: Dict[str, Any],
        failure_reasons: Optional[list[str]],
    ) -> str:
        shown_questions = question_context.get("shown_persona_questions")
        if not isinstance(shown_questions, list):
            shown_questions = []
        history_messages = question_context.get("history_messages")
        user_history = []
        if isinstance(history_messages, list):
            user_history = [
                str(message.get("content") or "")
                for message in history_messages
                if isinstance(message, dict) and message.get("role") == "user" and str(message.get("content") or "").strip()
            ][-6:]
        parts = [
            "本轮人设追问必须充分发挥 agent 判断能力，不使用固定题库。",
            "请先基于用户已表达的信息判断当前画像，再自行生成 3 个不同层次、不同方向、贴合当前画像的问题。",
            "只把问题放进 followUpQuestions 或 nextQuestions，正文 reply 不要列问题。",
            "每个问题必须具体、好回答、能推动人设更深入；不要问和当前画像无关的赛道。",
            "不要返回 examples；不要在问题下方附示例。",
            "如果用户已经给出具体兴趣或内容方向，必须由 agent 自行判断下一步最值得深挖的问题，不要套类型模板，也不要跳到无关赛道。",
            "新生成的问题不能重复下面已经展示过或已经回答过的问题，也不能只是换一种问法。",
            f"用户最新输入：{latest_message}",
        ]
        if user_history:
            parts.append("用户已回答内容：\n" + "\n".join(f"- {item}" for item in user_history))
        if shown_questions:
            parts.append("已经展示过的问题，不能再次出现或换问法重复：\n" + "\n".join(f"- {item}" for item in shown_questions[-20:]))
        if failure_reasons:
            parts.append("上一次输出被拒绝的原因：\n" + "\n".join(f"- {item}" for item in failure_reasons))
            parts.append("请根据失败原因重写 3 个全新的合格问题。")
        return "\n".join(parts)

    def _validate_persona_agent_questions(
        self,
        candidates: Any,
        payload: Dict[str, Any],
        question_context: Dict[str, Any],
    ) -> tuple[list[str], list[str]]:
        handler_context = {**question_context}
        answered_dimensions = self._answered_persona_dimensions(payload, handler_context)
        asked_signatures = self._asked_question_signatures(handler_context)
        asked_keys = self._asked_persona_question_keys(handler_context)
        raw_questions = [item for item in candidates if isinstance(item, str) and item.strip()] if isinstance(candidates, list) else []
        questions = self._filter_persona_questions(raw_questions, answered_dimensions, asked_signatures, asked_keys)
        history_messages = handler_context.get("history_messages")
        history_text = ""
        if isinstance(history_messages, list):
            history_text = " ".join(
                str(message.get("content") or "")
                for message in history_messages
                if isinstance(message, dict) and str(message.get("content") or "").strip()
            )
        context_text = f"{self._persona_context_text(payload, handler_context, raw_questions)} {history_text}".strip()
        reasons: list[str] = []
        if len(raw_questions) < 3:
            reasons.append("少于 3 个问题")
        if len(questions) < 3:
            reasons.append("过滤重复、已回答或无效问题后不足 3 个")
        if self._has_off_persona_question(raw_questions, context_text):
            reasons.append("问题和当前用户画像不匹配，例如短剧/追剧用户不能被问穿搭或衣服风格")
            questions = [question for question in questions if not self._has_off_persona_question([question], context_text)]
        layers = [self._persona_question_layer(question) or self._persona_question_semantic_key(question) for question in questions]
        if len(set(layer for layer in layers if layer)) < min(3, len(questions)):
            reasons.append("3 个问题层次太接近，需要从不同方向继续深挖")
            questions = questions[:1]
        return questions[:3], reasons

    def _filter_persona_questions(
        self,
        candidates: Any,
        answered_dimensions: set[str],
        asked_signatures: set[str],
        asked_keys: set[str],
    ) -> list[str]:
        if not isinstance(candidates, list):
            return []
        questions: list[str] = []
        seen: set[str] = set()
        seen_keys = set(asked_keys)
        for item in candidates:
            if not isinstance(item, str) or not item.strip():
                continue
            cleaned = self._compact(item, 42)
            signature = self._question_signature(cleaned)
            semantic_key = self._persona_question_semantic_key(cleaned)
            if not signature or signature in seen or signature in asked_signatures:
                continue
            if semantic_key and semantic_key in seen_keys:
                continue
            if self._is_answered_starter_question(cleaned, answered_dimensions):
                continue
            seen.add(signature)
            if semantic_key:
                seen_keys.add(semantic_key)
            questions.append(cleaned)
            if len(questions) >= 3:
                break
        return questions

    def _answered_persona_dimensions(self, payload: Dict[str, Any], handler_result: Dict[str, Any]) -> set[str]:
        dimensions: set[str] = set()
        history_messages = handler_result.get("history_messages")
        if not isinstance(history_messages, list):
            history_messages = []
        user_text = " ".join(
            str(message.get("content") or "")
            for message in history_messages
            if isinstance(message, dict) and message.get("role") == "user"
        )
        combined = user_text.lower()
        if self._matches(combined, ("身份", "阶段", "职业", "大学", "学生", "职场", "新人", "上班", "宝妈", "自由职业")):
            dimensions.add("identity")
        if self._matches(combined, ("兴趣", "喜欢", "爱好", "cos", "穿搭", "小说", "追剧", "美妆", "护肤", "手帐", "手账", "摄影", "乙游", "游戏", "卡面", "抽卡", "恋与深空")):
            dimensions.add("interest")
        if self._matches(combined, ("擅长", "会", "经验", "教程", "整理", "清单", "吐槽", "避雷", "测评", "分享")):
            dimensions.add("strength")
        if self._matches(combined, ("语气", "表达", "风格", "真实", "搞笑", "吐槽", "朋友", "松弛", "治愈")):
            dimensions.add("tone")
        if self._matches(combined, ("素材", "拍", "图片", "工位", "宿舍", "通勤", "日常", "实拍", "出片")):
            dimensions.add("material")
        if self._matches(combined, ("受众", "人群", "粉丝", "想吸引", "同款", "新手", "姐妹", "同龄")):
            dimensions.add("audience")
        return dimensions

    def _asked_question_signatures(self, handler_result: Dict[str, Any]) -> set[str]:
        history_messages = handler_result.get("history_messages")
        signatures: set[str] = set()
        shown_signatures = handler_result.get("shown_persona_question_signatures")
        if isinstance(shown_signatures, list):
            signatures.update(str(item) for item in shown_signatures if isinstance(item, str) and item.strip())
        if not isinstance(history_messages, list):
            return signatures
        for message in history_messages:
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            blocks = message.get("question_blocks")
            if isinstance(blocks, list):
                for block in blocks:
                    if isinstance(block, dict):
                        signatures.add(self._question_signature(str(block.get("question") or "")))
            content = str(message.get("content") or "")
            for segment in re.findall(r"[^。！？?\n]*[？?]", content):
                signatures.add(self._question_signature(segment))
        signatures.discard("")
        return signatures

    def _asked_persona_question_keys(self, handler_result: Dict[str, Any]) -> set[str]:
        keys: set[str] = set()
        shown_keys = handler_result.get("shown_persona_question_keys")
        if isinstance(shown_keys, list):
            keys.update(str(item) for item in shown_keys if isinstance(item, str) and item.strip())
        shown_questions = handler_result.get("shown_persona_questions")
        if isinstance(shown_questions, list):
            for question in shown_questions:
                semantic_key = self._persona_question_semantic_key(str(question or ""))
                if semantic_key:
                    keys.add(semantic_key)
        history_messages = handler_result.get("history_messages")
        if isinstance(history_messages, list):
            for message in history_messages:
                if not isinstance(message, dict) or message.get("role") != "assistant":
                    continue
                blocks = message.get("question_blocks")
                if isinstance(blocks, list):
                    for block in blocks:
                        if isinstance(block, dict):
                            semantic_key = self._persona_question_semantic_key(str(block.get("question") or ""))
                            if semantic_key:
                                keys.add(semantic_key)
                content = str(message.get("content") or "")
                for segment in re.findall(r"[^。！？?\n]*[？?]", content):
                    semantic_key = self._persona_question_semantic_key(segment)
                    if semantic_key:
                        keys.add(semantic_key)
        return keys

    def _question_signature(self, question: str) -> str:
        normalized = unicodedata.normalize("NFKC", question or "").lower()
        return "".join(char for char in normalized if char.isalnum())[:36]

    def _persona_question_semantic_key(self, question: str) -> str:
        text = re.sub(r"\s+", "", (question or "").lower())
        if not text:
            return ""
        if self._matches(text, ("受众", "人群", "粉丝", "谁看", "吸引谁", "帮助", "共鸣")):
            return "deep_audience"
        if self._matches(text, ("素材", "拍", "图片", "场景", "工位", "宿舍", "通勤", "上课", "实拍")):
            return "deep_material"
        if self._matches(text, ("边界", "不碰", "不想聊", "不想做")):
            return "deep_boundary"
        if self._matches(text, ("语气", "表达", "风格", "气质", "口吻")):
            return "deep_tone"
        if self._matches(text, ("不同", "区别", "特点", "记住", "差异")):
            return "deep_differentiator"
        if self._matches(text, ("卡面", "抽卡", "剧情", "安利", "避雷", "教程", "测评", "栏目", "日记", "清单")):
            return "deep_content_angle"
        if self._matches(text, ("更新", "稳定", "频率", "多久", "轻量", "长文", "栏目", "日记", "清单")):
            return "deep_rhythm"
        if self._matches(text, ("身份", "阶段", "职业", "学生", "上班", "在做什么")):
            return "starter_identity"
        if self._matches(text, ("兴趣", "喜欢", "爱好", "愿意聊", "最容易聊", "作品", "角色")):
            return "starter_interest"
        if self._matches(text, ("擅长", "分享什么", "会什么", "能讲", "经验", "教程", "测评")):
            return "starter_strength"
        return self._question_signature(question)[:24]

    def _is_answered_starter_question(self, question: str, answered_dimensions: set[str]) -> bool:
        dimension = self._persona_question_dimension(question)
        return dimension in {"identity", "interest", "strength"} and dimension in answered_dimensions

    def _persona_question_dimension(self, question: str) -> str:
        text = question.lower()
        if self._matches(text, ("身份", "阶段", "职业", "学生", "上班")):
            return "identity"
        if self._matches(text, ("兴趣", "喜欢", "愿意聊", "作品", "角色")):
            return "interest"
        if self._matches(text, ("擅长", "分享什么", "会什么", "能讲")):
            return "strength"
        if self._matches(text, ("语气", "表达", "风格", "气质", "口吻")):
            return "tone"
        if self._matches(text, ("素材", "拍", "图片", "场景", "工位", "宿舍", "通勤")):
            return "material"
        if self._matches(text, ("受众", "人群", "吸引", "粉丝", "谁看")):
            return "audience"
        return ""

    def _persona_question_layer(self, question: str) -> str:
        text = question.lower()
        if self._matches(text, ("身份", "阶段", "职业", "学生", "上班")):
            return "identity"
        if self._matches(text, ("兴趣", "喜欢", "愿意聊", "作品", "角色")):
            return "interest"
        if self._matches(text, ("擅长", "分享什么", "会什么", "经验", "教程", "避雷", "测评", "栏目")):
            return "content_angle"
        if self._matches(text, ("受众", "人群", "吸引", "粉丝", "谁看", "帮助", "共鸣", "新手")):
            return "audience"
        if self._matches(text, ("素材", "拍", "图片", "场景", "工位", "宿舍", "通勤", "上课")):
            return "material"
        if self._matches(text, ("语气", "表达", "风格", "气质", "口吻", "不想")):
            return "tone_boundary"
        if self._matches(text, ("不同", "区别", "特点", "记住")):
            return "differentiator"
        if self._matches(text, ("更新", "稳定", "轻量", "长文")):
            return "rhythm"
        return ""

    def _persona_recovery_reply(
        self,
        latest_message: str,
        question_context: Dict[str, Any],
        failure_reasons: list[str],
        payload: Dict[str, Any] | None = None,
    ) -> str:
        del latest_message, question_context, failure_reasons
        preview = self._persona_copy_text(payload or {})
        if preview:
            return (
                f"{preview}\n\n"
                "这个人设已经有雏形了，你可以继续补充细节。\n\n"
                "如果你觉得这版人设已经够用了，也可以点保存人设，我会带你进入热门追踪。"
            )
        return (
            "先从这 3 个轻松问题里挑一个就行。\n\n"
            "不用一次说完整，随便补一句也可以，我会继续帮你把人设往可保存的方向整理。"
        )

    def _persona_recovery_questions(
        self,
        latest_message: str,
        question_context: Dict[str, Any],
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> list[str]:
        context = {**question_context}
        payload = self._payload(module_memories.get("persona")) if isinstance(module_memories, dict) else {}
        context_text = self._persona_recovery_context_text(latest_message, context)
        answered_dimensions = self._answered_persona_dimensions(payload, context)
        for dimension in self._missing_persona_dimensions(context_text):
            if dimension == "身份阶段":
                answered_dimensions.discard("identity")
            elif dimension == "兴趣方向":
                answered_dimensions.discard("interest")
        asked_signatures = self._asked_question_signatures(context)
        asked_keys = self._asked_persona_question_keys(context)
        return self._filter_persona_questions(
            self._layered_persona_recovery_questions(),
            answered_dimensions,
            asked_signatures,
            asked_keys,
        )

    def _dynamic_persona_fallback_questions(self, context_text: str) -> list[str]:
        del context_text
        return self._layered_persona_recovery_questions()

    def _layered_persona_fallback_questions(self, context_text: str) -> list[str]:
        del context_text
        return self._layered_persona_recovery_questions()

    def _layered_persona_recovery_questions(self) -> list[str]:
        return [
            "你现在是什么身份或阶段？比如学生、职场新人、宝妈、自由职业都可以说",
            "你最愿意长期聊什么？比如爱好、生活经验、学习工作、喜欢的内容都可以",
            "你更想分享哪类内容？比如测评、清单、避坑、教程、真实日常都可以",
            "你最想让哪类人看到你？比如同好、新手、同龄人、正在踩坑的人都可以",
            "你手上最容易拿出来的素材是什么？比如截图、照片、日常片段、笔记都可以",
            "你希望自己的表达更像哪种感觉？比如真实陪伴、轻松吐槽、认真整理、温柔安利都可以",
            "有哪些内容或表达是你明确不想做的？比如露脸、争议话题、太硬的教程都可以",
            "如果把你和同类账号区分开，你希望别人记住你的哪个特点？",
            "围绕这个方向，你更想先做哪种固定栏目？比如避坑清单、体验日记、入门攻略、好物测评都可以",
            "你更适合什么更新节奏？比如随手记录、每周整理、追热点补充、长期慢慢写都可以",
            "你想让读者看完之后获得什么？比如省时间、被安慰、少踩坑、马上能照做都可以",
            "你现在最有把握连续讲三期的具体小主题是什么？",
        ]

    def _missing_persona_dimensions(self, context_text: str) -> list[str]:
        text = re.sub(r"\s+", "", context_text or "").lower()
        checks = [
            ("身份阶段", ("身份", "阶段", "职业", "学生", "职场", "宝妈", "自由职业", "大学")),
            ("兴趣方向", ("兴趣", "喜欢", "爱好", "修仙", "小说", "短剧", "游戏", "美妆", "穿搭", "学习")),
            ("内容角度", ("测评", "清单", "教程", "吐槽", "避坑", "安利", "整理", "分享")),
            ("可拍素材", ("素材", "截图", "图片", "拍", "桌面", "宿舍", "通勤", "记录")),
            ("表达风格", ("语气", "表达", "风格", "真实", "搞笑", "温柔", "吐槽", "陪伴")),
            ("目标受众", ("受众", "人群", "粉丝", "吸引", "新手", "同龄", "姐妹", "同好")),
        ]
        return [label for label, keywords in checks if not self._matches(text, keywords)]

    def _persona_recovery_context_text(
        self,
        latest_message: str,
        question_context: Dict[str, Any],
    ) -> str:
        parts = [latest_message]
        history_messages = question_context.get("history_messages")
        if isinstance(history_messages, list):
            parts.extend(
                str(message.get("content") or "")
                for message in history_messages
                if isinstance(message, dict) and str(message.get("content") or "").strip()
            )
        return " ".join(parts)

    def _persona_context_text(
        self,
        payload: Dict[str, Any],
        handler_result: Dict[str, Any],
        questions: list[str],
    ) -> str:
        parts = [
            " ".join(questions),
            str(handler_result.get("reply") or ""),
            str(handler_result.get("summary_text") or ""),
        ]
        if payload:
            try:
                parts.append(json.dumps(payload, ensure_ascii=False))
            except TypeError:
                parts.append(str(payload))
        return " ".join(parts)

    def _persona_question_examples(self, question: str, context_text: str) -> list[str]:
        return []

    def _extract_persona_questions(self, data: Dict[str, Any], payload: Any) -> list[str]:
        candidates = data.get("followUpQuestions") or data.get("nextQuestions")
        if not isinstance(candidates, list) and isinstance(payload, dict):
            candidates = payload.get("followUpQuestions") or payload.get("nextQuestions")
        if not isinstance(candidates, list):
            return []
        return [str(item).strip() for item in candidates if isinstance(item, str) and item.strip()]

    def _merge_persona_follow_up_payload(
        self,
        existing_payload: Dict[str, Any],
        incoming_payload: Any,
        latest_message: str,
    ) -> Dict[str, Any]:
        incoming = incoming_payload if isinstance(incoming_payload, dict) else {}
        if not existing_payload:
            merged = deepcopy(incoming)
        else:
            incoming_draft = incoming.get("personaDraft") if isinstance(incoming.get("personaDraft"), dict) else incoming
            merged = self._deep_merge_persona_payload(existing_payload, incoming_draft if isinstance(incoming_draft, dict) else {})
            for key in ("followUpQuestions", "nextQuestions", "isReadyToSave", "conversationSummary", "memoryMeta", "basicInfo"):
                if key in incoming:
                    merged[key] = deepcopy(incoming[key])
        self._apply_persona_message_hint(merged, latest_message)
        return merged

    def _deep_merge_persona_payload(self, base: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
        merged = deepcopy(base) if isinstance(base, dict) else {}
        for key, value in incoming.items():
            if value in (None, "", [], {}):
                continue
            current = merged.get(key)
            if isinstance(current, dict) and isinstance(value, dict):
                merged[key] = self._deep_merge_persona_payload(current, value)
            elif isinstance(current, list) and isinstance(value, list):
                merged[key] = self._merge_unique_text_list(current, value)
            else:
                merged[key] = deepcopy(value)
        return merged

    def _apply_persona_message_hint(self, payload: Dict[str, Any], latest_message: str) -> None:
        hint = self._clean_persona_user_hint(latest_message)
        if not hint:
            return
        text = re.sub(r"\s+", "", hint.lower())
        if self._matches(text, ("文案", "长文案", "短文案", "图配文", "碎碎念", "文学", "文艺", "诗意", "表达")):
            self._append_persona_list_value(payload, "contentStyle", hint)
        elif self._matches(text, ("同龄", "新手", "用户", "网友", "粉丝", "受众", "人群", "姐妹", "同好")):
            self._append_persona_list_value(payload, "audience", hint)
        elif self._matches(text, ("照片", "截图", "素材", "手机", "日常", "实拍", "图片", "视频")):
            self._append_persona_list_value(payload, "referenceCreatorDirections", hint)
        else:
            persona = payload.get("persona") if isinstance(payload.get("persona"), dict) else {}
            description = str(persona.get("description") or "").strip()
            if hint not in description:
                persona["description"] = f"{description}，补充偏好：{hint}" if description else f"补充偏好：{hint}"
            payload["persona"] = persona

    def _append_persona_list_value(self, payload: Dict[str, Any], key: str, value: str) -> None:
        current = payload.get(key)
        values = current if isinstance(current, list) else []
        payload[key] = self._merge_unique_text_list(values, [value], limit=4)

    def _merge_unique_text_list(self, current: list[Any], incoming: list[Any], *, limit: int = 6) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for item in [*current, *incoming]:
            text = str(item or "").strip()
            if not text:
                continue
            signature = self._question_signature(text)
            if signature in seen:
                continue
            result.append(text)
            seen.add(signature)
            if len(result) >= limit:
                break
        return result

    def _clean_persona_user_hint(self, latest_message: str) -> str:
        text = str(latest_message or "").strip()
        if not text:
            return ""
        if ":" in text:
            text = text.rsplit(":", 1)[-1].strip()
        if "：" in text:
            text = text.rsplit("：", 1)[-1].strip()
        text = re.sub(r"^(我希望|我想|我更想|希望|更偏向于|偏向于|可以|就是|是)", "", text).strip(" ，。,.！!？?")
        return self._compact(text, 40)

    def _content_revision_actions(self, payload: Dict[str, Any]) -> list[str]:
        if not payload:
            return []
        suggestions = payload.get("suggestions")
        labels: list[str] = []
        if isinstance(suggestions, list):
            for item in suggestions:
                if isinstance(item, dict):
                    label = self._read_string(item.get("label"))
                    instruction = self._read_string(item.get("instruction"))
                    candidate = label or instruction
                else:
                    candidate = self._read_string(item)
                if candidate and candidate not in labels:
                    labels.append(self._compact(candidate, 18))
                if len(labels) >= 3:
                    return labels
        title = self._read_string(payload.get("title"))
        tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
        fallback = [
            f"标题更像小红书" if title else "标题更抓人",
            "开头更像真实经历",
            "语气更亲切好懂",
        ]
        if tags:
            fallback.append("标签更贴近人设")
        return fallback[:3]

    def _copy_payload_for_step(
        self,
        step: str,
        module_memories: Dict[str, Optional[Dict[str, Any]]],
    ) -> Dict[str, Any]:
        payload = self._payload(module_memories.get(step))
        if step == "content":
            publish_text = self._content_publish_text(payload)
            return {"publish_text": publish_text, "copy_text": publish_text, "draft": payload} if payload else {"publish_text": publish_text, "copy_text": publish_text}
        if step == "trending":
            return {"copy_text": self._trend_copy_text(payload)}
        if step == "persona":
            return {"copy_text": self._persona_copy_text(payload)}
        return {"copy_text": ""}

    def _trend_display_text(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        lines = []
        track_name = str(payload.get("trackName") or "").strip()
        trends = str(payload.get("trends") or "").strip()
        audience = str(payload.get("audience") or "").strip()
        titles = self._trend_titles(payload)
        if track_name:
            lines.append(f"**趋势维度：**小红书 / 近七天 / {track_name}")
        if trends:
            lines.append(f"**趋势总结：**{trends}")
            lines.append(f"**当前热点包括：**{trends}")
        if audience:
            lines.append(f"**受众需求：**{audience}")
        if titles:
            lines.append(
                "**推荐选题：**\n"
                + "\n".join(
                    f"{index}. {title}，可以直接点进内容撰写，写成一篇小红书图文。"
                    for index, title in enumerate(titles, 1)
                )
            )
        return "\n\n".join(lines)

    def _trend_reply(self, data: Dict[str, Any], payload: Dict[str, Any]) -> str:
        text = self._full_trend_text(data, payload)
        if not text.strip():
            text = "我先帮你整理一版热门追踪结果。"
        return self._bold_report_labels(self._humanize_trend_terms(text.strip()))

    def _full_trend_text(self, data: Dict[str, Any], payload: Dict[str, Any]) -> str:
        raw = data.get("raw")
        formatter = getattr(self.trend_service, "_format_trend_text", None)
        if callable(formatter) and isinstance(raw, dict):
            try:
                formatted = formatter(raw)
                if self._has_full_trend_sections(formatted):
                    return formatted
            except Exception:
                pass

        text = data.get("text") if isinstance(data.get("text"), str) else ""
        if self._has_full_trend_sections(text):
            return text

        compact_text = self._trend_display_text(payload)
        if compact_text.strip():
            return compact_text
        return text

    def _has_full_trend_sections(self, text: str) -> bool:
        if not isinstance(text, str) or not text.strip():
            return False
        labels = ("趋势总结", "当前热点包括", "受众需求", "推荐选题")
        return sum(1 for label in labels if label in text) >= 3

    def _humanize_trend_terms(self, text: str) -> str:
        cleaned = re.sub(r"\b7d\b", "近七天", text or "", flags=re.IGNORECASE)
        cleaned = re.sub(r"\bxiaohongshu\b", "小红书", cleaned, flags=re.IGNORECASE)
        return cleaned

    def _bold_report_labels(self, text: str) -> str:
        labels = ("趋势维度", "趋势总结", "当前热点包括", "受众需求", "推荐选题")
        cleaned = text
        for label in labels:
            cleaned = re.sub(rf"(?m)^(\s*(?:[-*]\s*)?)(?!\*\*)({label})\s*[:：]\s*", rf"\1**\2：**", cleaned)
        return cleaned

    def _content_display_text(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        formatter = getattr(self.content_service, "_format_content_text", None)
        if callable(formatter):
            try:
                return formatter({"draft": payload})
            except Exception:
                return ""
        return ""

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
            payload = memory.get("payload") if isinstance(memory, dict) and isinstance(memory.get("payload"), dict) else {}
            summary_text = memory.get("summary_text", "") if memory else ""
            if module == "persona":
                summary_text = self._persona_summary(payload) or summary_text
            summary[module] = {
                "done": bool(memory and memory.get("done")),
                "title": SUMMARY_TITLES[module],
                "text": summary_text if memory and (memory.get("done") or module in {"trending", "content"}) else "",
                "message_id": memory.get("source_message_id") if memory else None,
                "memory_id": memory.get("memory_id") if memory else None,
            }
            if module == "trending":
                evidence_summary = payload.get("evidenceSummary") if isinstance(payload, dict) else None
                if isinstance(evidence_summary, dict):
                    summary[module]["evidence_summary"] = evidence_summary
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
        content_memory = module_memories.get("content")
        if isinstance(content_memory, dict) and content_memory.get("done"):
            summary = self._summary_for_payload("content", self._payload(content_memory))
            if summary:
                return summary
        trending_memory = module_memories.get("trending")
        if isinstance(trending_memory, dict):
            return self._trend_summary(self._payload(trending_memory)) or SUMMARY_TITLES["trending"]
        persona_memory = module_memories.get("persona")
        if isinstance(persona_memory, dict):
            return SUMMARY_TITLES["trending"] if persona_memory.get("done") else (
                self._compact(self._persona_summary(self._payload(persona_memory)) or str(persona_memory.get("summary_text") or ""), 24)
                or SUMMARY_TITLES["persona"]
            )
        persona_summary = self._conversation_persona_summary(module_memories)
        return persona_summary or "新的创作对话"

    def _saved_conversation_title(self, step: str, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> str:
        if step in {"persona", "trending", "content"}:
            summary = self._summary_for_payload(step, self._payload(module_memories.get(step)))
            if summary:
                return summary
        return self._conversation_title(module_memories)

    def _conversation_persona_summary(self, module_memories: Dict[str, Optional[Dict[str, Any]]]) -> str:
        persona_memory = module_memories.get("persona")
        if not isinstance(persona_memory, dict) or not persona_memory.get("done"):
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
        preview = self._persona_copy_text(payload)
        if isinstance(reply, str) and reply.strip():
            cleaned_reply = self._bold_persona_labels(reply.strip())
            preview_title = preview.splitlines()[0] if preview else ""
            if preview and preview_title and preview_title not in cleaned_reply[:80]:
                return self._append_persona_save_hint(f"{preview}\n\n{cleaned_reply}")
            return self._append_persona_save_hint(cleaned_reply)
        summary = self._persona_summary(payload)
        if preview:
            return self._append_persona_save_hint(f"{preview}\n\n这个人设已经有雏形了，你可以继续补充细节。")
        return self._append_persona_save_hint(f"我们先把人设定下来：{summary}" if summary else "我们先把人设定下来。")

    def _bold_persona_labels(self, text: str) -> str:
        labels = ("人设标题", "内容方向", "目标受众", "内容风格")
        cleaned = text
        for label in labels:
            cleaned = re.sub(rf"(?m)^(?!\*\*)({label})\s*[:：]\s*", rf"**\1：**", cleaned)
        return cleaned

    def _append_persona_save_hint(self, text: str) -> str:
        hint = "如果你觉得这版人设已经够用了，也可以点保存人设，我会带你进入热门追踪。"
        cleaned = text.strip()
        return cleaned if hint in cleaned else f"{cleaned}\n\n{hint}"

    def _persona_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        persona = payload.get("persona") if isinstance(payload.get("persona"), dict) else {}
        card_preview = payload.get("cardPreview") if isinstance(payload.get("cardPreview"), dict) else {}
        draft = payload.get("personaDraft") if isinstance(payload.get("personaDraft"), dict) else {}
        draft_persona = draft.get("persona") if isinstance(draft.get("persona"), dict) else {}
        return self._compact(
            str(
                persona.get("name")
                or persona.get("title")
                or draft_persona.get("name")
                or draft_persona.get("title")
                or payload.get("title")
                or draft.get("title")
                or card_preview.get("personaLabel")
                or persona.get("description")
                or ""
            ),
            24,
        )

    def _trend_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        return self._compact(str(payload.get("trackName") or (self._trend_titles(payload) or [""])[0]), 24)

    def _content_summary(self, payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""
        return self._compact(str(payload.get("title") or payload.get("selectedTitle") or payload.get("intro") or ""), 32)

    def _summary_for_payload(self, step: str, payload: Dict[str, Any]) -> str:
        if step == "persona":
            return self._persona_summary(payload)
        if step == "trending":
            return self._trend_summary(payload)
        if step == "content":
            return self._content_summary(payload)
        return ""

    def _persona_ready(self, payload: Dict[str, Any], handler_result: Dict[str, Any]) -> bool:
        if not self._has_persona_payload(payload):
            return False
        if handler_result.get("readiness") == "ready_for_approval":
            return True
        if bool(payload.get("isReadyToSave")):
            return True
        draft = payload.get("personaDraft") if isinstance(payload.get("personaDraft"), dict) else {}
        if bool(draft.get("isReadyToSave")):
            return True
        has_core = (
            self._has_text(payload, ("persona", "niche"))
            and self._has_list_or_text(payload, "audience")
            and self._has_list_or_text(payload, "contentStyle")
        )
        has_creator_basis = self._has_list_or_text(payload, "referenceCreatorDirections") or self._has_text(
            payload,
            ("material", "materials", "imageMaterial", "photoAssets", "basicInfo"),
        )
        return bool(has_core and has_creator_basis and not self._persona_questions(payload, handler_result))

    def _trend_titles(self, payload: Dict[str, Any]) -> list[str]:
        raw_topics = payload.get("topics")
        titles: list[str] = []
        if isinstance(raw_topics, list):
            for item in raw_topics:
                if isinstance(item, str):
                    titles.append(item)
                elif isinstance(item, dict) and isinstance(item.get("title"), str):
                    titles.append(item["title"])
        opportunities = payload.get("topicOpportunities")
        if isinstance(opportunities, list):
            for item in opportunities:
                if isinstance(item, dict) and isinstance(item.get("title"), str):
                    titles.append(item["title"])
        return self._unique_compact_titles(titles, limit=3, max_length=20)

    def _unique_compact_titles(self, titles: list[str], *, limit: int, max_length: int) -> list[str]:
        seen = set()
        result = []
        for title in titles:
            cleaned = self._compact(str(title).strip(" #《》"), max_length)
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            result.append(cleaned)
            if len(result) >= limit:
                break
        return result

    def _content_publish_text(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        title = self._compact(str(payload.get("title") or payload.get("selectedTitle") or ""), 20)
        intro = self._clean_publish_text(str(payload.get("intro") or ""))
        body = payload.get("body")
        if isinstance(body, list):
            body_text = "\n\n".join(self._clean_publish_text(str(item)) for item in body if isinstance(item, str) and item.strip())
        else:
            body_text = self._clean_publish_text(str(body or ""))
        ending = self._clean_publish_text(str(payload.get("ending") or ""))
        tags = payload.get("tags")
        tag_list = []
        if isinstance(tags, list):
            tag_list = [f"#{self._clean_publish_tag(str(tag))}" for tag in tags if isinstance(tag, str) and tag.strip()]
        elif isinstance(tags, str):
            tag_list = [f"#{self._clean_publish_tag(tag)}" for tag in re.split(r"[\s,，、#]+", tags) if tag.strip()]
        tag_list = [tag for tag in tag_list if len(tag) > 1]
        if not title or not body_text:
            return ""
        publish_body = "\n\n".join(part for part in [intro, body_text, ending] if part)
        publish_body = publish_body[:1000].rstrip()
        return "\n\n".join(part for part in [title, publish_body, " ".join(tag_list[:5])] if part).strip()

    def _clean_publish_text(self, value: str) -> str:
        cleaned = re.sub(r"```+", "", value or "")
        cleaned = re.sub(r"`([^`\n]+)`", r"\1", cleaned)
        cleaned = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", cleaned)
        cleaned = re.sub(r"\*([^*\n]+)\*", r"\1", cleaned)
        cleaned = re.sub(r"__([^_\n]+)__", r"\1", cleaned)
        cleaned = re.sub(r"_([^_\n]+)_", r"\1", cleaned)
        lines = []
        for line in cleaned.replace("\r\n", "\n").splitlines():
            line = re.sub(r"^\s*#{1,6}\s+", "", line)
            line = re.sub(r"^\s*>\s?", "", line)
            line = re.sub(r"^\s*[-+•]\s+", "", line)
            line = re.sub(r"^\s*\d{1,3}[.)、]\s+", "", line)
            line = line.strip()
            if line:
                lines.append(line)
        return "\n".join(lines).strip()

    def _clean_publish_tag(self, value: str) -> str:
        return re.sub(r"[：:；;，,。.!?！？\s#]+", "", self._clean_publish_text(value).lstrip("#")).strip()

    def _trend_copy_text(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        parts = [
            str(payload.get("trackName") or "").strip(),
            str(payload.get("trends") or "").strip(),
            str(payload.get("audience") or "").strip(),
        ]
        titles = self._trend_titles(payload)
        if titles:
            parts.append("可写标题：\n" + "\n".join(f"{index}. {title}" for index, title in enumerate(titles, 1)))
        return "\n\n".join(part for part in parts if part).strip()

    def _persona_copy_text(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        persona = payload.get("persona") if isinstance(payload.get("persona"), dict) else {}
        niche = payload.get("niche") if isinstance(payload.get("niche"), dict) else {}
        audience = payload.get("audience") if isinstance(payload.get("audience"), list) else []
        content_style = payload.get("contentStyle") if isinstance(payload.get("contentStyle"), list) else []
        return "\n".join(
            part
            for part in [
                f"**人设标题：** {persona.get('name') or self._persona_summary(payload)}" if persona.get("name") or self._persona_summary(payload) else "",
                str(persona.get("description") or "").strip(),
                f"**内容方向：** {niche.get('primary')}" if niche.get("primary") else "",
                f"**目标受众：** {'、'.join(str(item) for item in audience[:3])}" if audience else "",
                f"**内容风格：** {'、'.join(str(item) for item in content_style[:3])}" if content_style else "",
            ]
            if part
        ).strip()

    def _save_module_payload(self, user_id: str, step: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if step == "persona":
            return self.persona_service.save_persona(user_id, payload)
        if step == "trending":
            return self.trend_service.save_trend_record(user_id, payload)
        if step == "content":
            return self.content_service.save_draft_record(user_id, payload)
        return {"status": "failed", "message": "Unsupported module"}

    def _has_text(self, payload: Dict[str, Any], keys: tuple[str, ...]) -> bool:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return True
            if isinstance(value, dict) and any(str(item).strip() for item in value.values() if isinstance(item, (str, int, float))):
                return True
        return False

    def _has_list_or_text(self, payload: Dict[str, Any], key: str) -> bool:
        value = payload.get(key)
        if isinstance(value, list):
            return any(str(item).strip() for item in value if isinstance(item, (str, int, float)))
        if isinstance(value, str):
            return bool(value.strip())
        return False

    def _read_string(self, value: Any) -> str:
        return value.strip() if isinstance(value, str) else ""

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
            "actions": [],
            "question_blocks": [],
            "readiness": {
                "persona": "needs_more_info",
                "trending": "needs_more_info",
                "content": "needs_more_info",
            },
            "copy_payload": {"copy_text": ""},
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
