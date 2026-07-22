from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

from ...database import memory_db


class MemoryCRUD:
    def get_memory_state(self, user_id: str, scope_id: str) -> Optional[Dict[str, Any]]:
        collection = memory_db.conversation_memory
        doc = collection.find_one({"user_id": user_id, "scope_id": scope_id})
        return doc.get("data") if doc else None

    def save_memory_state(self, user_id: str, scope_id: str, payload: Dict[str, Any]) -> None:
        collection = memory_db.conversation_memory
        collection.update_one(
            {"user_id": user_id, "scope_id": scope_id},
            {
                "$set": {
                    "user_id": user_id,
                    "scope_id": scope_id,
                    "data": payload,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    def ensure_agent_chat_indexes(self) -> None:
        memory_db.agent_chat_conversations.create_index([("user_id", 1), ("conversation_id", 1)], unique=True)
        memory_db.agent_chat_conversations.create_index([("user_id", 1), ("source_persona_record_id", 1)])
        memory_db.agent_chat_conversations.create_index([("user_id", 1), ("parent_conversation_id", 1)])
        memory_db.agent_chat_messages.create_index([("user_id", 1), ("conversation_id", 1), ("created_at", 1)])
        memory_db.agent_chat_messages.create_index([("user_id", 1), ("conversation_id", 1), ("message_id", 1)], unique=True)
        memory_db.agent_module_memories.create_index([("user_id", 1), ("conversation_id", 1), ("memory_id", 1)], unique=True)
        memory_db.agent_module_memories.create_index([("user_id", 1), ("conversation_id", 1), ("module", 1), ("updated_at", -1)])
        memory_db.agent_module_memories.create_index([("user_id", 1), ("conversation_id", 1), ("module", 1), ("created_at", 1)])

    def get_agent_chat_conversation(self, user_id: str, conversation_id: str) -> Optional[Dict[str, Any]]:
        return memory_db.agent_chat_conversations.find_one(
            {"user_id": user_id, "conversation_id": conversation_id},
            {"_id": 0},
        )

    def list_agent_chat_conversations(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        return list(
            memory_db.agent_chat_conversations.find(
                {"user_id": user_id},
                {"_id": 0},
            )
            .sort("updated_at", -1)
            .limit(limit)
        )

    def upsert_agent_chat_conversation(
        self,
        user_id: str,
        conversation_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        existing = self.get_agent_chat_conversation(user_id, conversation_id)
        created_at = existing.get("created_at") if existing else now
        doc = {
            **payload,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "created_at": created_at,
            "updated_at": now,
        }
        memory_db.agent_chat_conversations.update_one(
            {"user_id": user_id, "conversation_id": conversation_id},
            {"$set": doc},
            upsert=True,
        )
        return doc

    def save_agent_chat_message(
        self,
        *,
        user_id: str,
        conversation_id: str,
        role: str,
        content: str,
        step: str,
        message_id: Optional[str] = None,
        question_blocks: Optional[List[Dict[str, Any]]] = None,
        copy_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        doc = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "message_id": message_id or f"msg_{uuid4().hex[:8]}",
            "role": role,
            "content": content,
            "step": step,
            "created_at": now,
        }
        if question_blocks:
            doc["question_blocks"] = question_blocks
        if copy_payload:
            doc["copy_payload"] = copy_payload
        memory_db.agent_chat_messages.insert_one(doc)
        return {key: value for key, value in doc.items() if key != "_id"}

    def update_agent_chat_message(
        self,
        user_id: str,
        conversation_id: str,
        message_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        updates = {key: value for key, value in payload.items() if key in {"question_blocks", "copy_payload"}}
        if not updates:
            return {}
        memory_db.agent_chat_messages.update_one(
            {"user_id": user_id, "conversation_id": conversation_id, "message_id": message_id},
            {"$set": updates},
        )
        doc = memory_db.agent_chat_messages.find_one(
            {"user_id": user_id, "conversation_id": conversation_id, "message_id": message_id},
            {"_id": 0},
        )
        return doc or {}

    def list_agent_chat_messages(self, user_id: str, conversation_id: str, limit: int = 80) -> List[Dict[str, Any]]:
        docs = list(
            memory_db.agent_chat_messages.find(
                {"user_id": user_id, "conversation_id": conversation_id},
                {"_id": 0},
            )
            .sort("created_at", -1)
            .limit(limit)
        )
        return list(reversed(docs))

    def save_agent_module_memory(
        self,
        *,
        user_id: str,
        conversation_id: str,
        module: str,
        title: str,
        summary_text: str,
        payload: Dict[str, Any],
        source_message_id: str,
        done: bool = True,
        memory_id: Optional[str] = None,
        parent_refs: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        now = datetime.utcnow()
        target_memory_id = memory_id or f"{module}_{uuid4().hex[:8]}"
        existing = self.get_agent_module_memory(user_id, conversation_id, target_memory_id)
        created_at = existing.get("created_at") if existing else now
        doc = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "memory_id": target_memory_id,
            "module": module,
            "done": done,
            "title": title,
            "summary_text": summary_text,
            "payload": payload,
            "source_message_id": source_message_id,
            "parent_refs": parent_refs or {},
            "created_at": created_at,
            "updated_at": now,
        }
        memory_db.agent_module_memories.update_one(
            {"user_id": user_id, "conversation_id": conversation_id, "memory_id": target_memory_id},
            {"$set": doc},
            upsert=True,
        )
        return doc

    def get_agent_module_memory(
        self,
        user_id: str,
        conversation_id: str,
        memory_id: str,
    ) -> Optional[Dict[str, Any]]:
        return memory_db.agent_module_memories.find_one(
            {"user_id": user_id, "conversation_id": conversation_id, "memory_id": memory_id},
            {"_id": 0},
        )

    def get_latest_agent_module_memory(
        self,
        user_id: str,
        conversation_id: str,
        module: str,
    ) -> Optional[Dict[str, Any]]:
        return memory_db.agent_module_memories.find_one(
            {"user_id": user_id, "conversation_id": conversation_id, "module": module},
            {"_id": 0},
            sort=[("updated_at", -1)],
        )

    def list_agent_module_memories(
        self,
        user_id: str,
        conversation_id: str,
        module: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        return list(
            memory_db.agent_module_memories.find(
                {"user_id": user_id, "conversation_id": conversation_id, "module": module},
                {"_id": 0},
            )
            .sort("created_at", 1)
            .limit(limit)
        )

    def delete_agent_chat_user_data(self, user_id: str) -> None:
        memory_db.agent_chat_conversations.delete_many({"user_id": user_id})
        memory_db.agent_chat_messages.delete_many({"user_id": user_id})
        memory_db.agent_module_memories.delete_many({"user_id": user_id})

    def delete_agent_chat_conversation(self, user_id: str, conversation_id: str) -> bool:
        result = memory_db.agent_chat_conversations.delete_one(
            {"user_id": user_id, "conversation_id": conversation_id}
        )
        memory_db.agent_chat_messages.delete_many({"user_id": user_id, "conversation_id": conversation_id})
        memory_db.agent_module_memories.delete_many({"user_id": user_id, "conversation_id": conversation_id})
        return result.deleted_count > 0

    def delete_empty_agent_chat_conversations(self, user_id: str) -> int:
        legacy_cutoff = datetime.utcnow() - timedelta(minutes=5)
        pending_cutoff = datetime.utcnow() - timedelta(minutes=30)
        candidates = list(
            memory_db.agent_chat_conversations.find(
                {
                    "user_id": user_id,
                    "title": {"$in": ["新建对话", "新的创作对话"]},
                    "active_persona_memory_id": None,
                    "active_trending_memory_id": None,
                    "active_content_memory_id": None,
                },
                {"conversation_id": 1, "create_status": 1, "created_at": 1},
            )
        )
        deleted_count = 0
        for conversation in candidates:
            conversation_id = conversation.get("conversation_id")
            if not isinstance(conversation_id, str) or not conversation_id:
                continue
            create_status = conversation.get("create_status")
            created_at = conversation.get("created_at")
            is_failed_create = (
                create_status in {"creating", "questions_failed"}
                and isinstance(created_at, datetime)
                and created_at < legacy_cutoff
            )
            is_stale_pending = (
                create_status == "questions_pending"
                and isinstance(created_at, datetime)
                and created_at < pending_cutoff
            )
            is_legacy_empty = (
                create_status is None
                and isinstance(created_at, datetime)
                and created_at < legacy_cutoff
            )
            if not is_failed_create and not is_stale_pending and not is_legacy_empty:
                continue
            has_user_message = memory_db.agent_chat_messages.count_documents(
                {"user_id": user_id, "conversation_id": conversation_id, "role": "user"},
                limit=1,
            )
            has_module_memory = memory_db.agent_module_memories.count_documents(
                {"user_id": user_id, "conversation_id": conversation_id},
                limit=1,
            )
            if has_user_message or has_module_memory:
                continue
            if self.delete_agent_chat_conversation(user_id, conversation_id):
                deleted_count += 1
        return deleted_count

    def delete_agent_chat_conversations_by_persona_record(self, user_id: str, persona_record_id: str) -> int:
        conversations = list(
            memory_db.agent_chat_conversations.find(
                {"user_id": user_id, "source_persona_record_id": persona_record_id},
                {"conversation_id": 1},
            )
        )
        deleted_count = 0
        for conversation in conversations:
            conversation_id = conversation.get("conversation_id")
            if not isinstance(conversation_id, str) or not conversation_id:
                continue
            if self.delete_agent_chat_conversation(user_id, conversation_id):
                deleted_count += 1
        return deleted_count
