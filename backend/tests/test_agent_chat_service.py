from __future__ import annotations

from datetime import datetime

import pytest

try:
    from backend.app.services.agent_chat import UnifiedAgentChatService
except ModuleNotFoundError:
    from app.services.agent_chat import UnifiedAgentChatService


class FakeMemoryCRUD:
    def __init__(self) -> None:
        self.conversations = {}
        self.messages = []
        self.memories = {}

    def ensure_agent_chat_indexes(self) -> None:
        return None

    def get_agent_chat_conversation(self, user_id: str, conversation_id: str):
        return self.conversations.get((user_id, conversation_id))

    def list_agent_chat_conversations(self, user_id: str, limit: int = 50):
        return [
            conversation
            for (conversation_user, _), conversation in self.conversations.items()
            if conversation_user == user_id
        ][-limit:]

    def upsert_agent_chat_conversation(self, user_id: str, conversation_id: str, payload: dict):
        existing = self.conversations.get((user_id, conversation_id), {})
        doc = {
            **existing,
            **payload,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "created_at": existing.get("created_at") or datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        self.conversations[(user_id, conversation_id)] = doc
        return doc

    def save_agent_chat_message(self, *, user_id: str, conversation_id: str, role: str, content: str, step: str, message_id=None):
        doc = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "message_id": message_id or f"msg_{len(self.messages) + 1}",
            "role": role,
            "content": content,
            "step": step,
            "created_at": datetime.utcnow(),
        }
        self.messages.append(doc)
        return doc

    def list_agent_chat_messages(self, user_id: str, conversation_id: str, limit: int = 80):
        return [
            message
            for message in self.messages
            if message["user_id"] == user_id and message["conversation_id"] == conversation_id
        ][-limit:]

    def save_agent_module_memory(
        self,
        *,
        user_id: str,
        conversation_id: str,
        module: str,
        title: str,
        summary_text: str,
        payload: dict,
        source_message_id: str,
        done: bool = True,
        memory_id=None,
        parent_refs=None,
    ):
        target_memory_id = memory_id or f"{module}_{len(self.memories) + 1}"
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
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        self.memories[(user_id, conversation_id, target_memory_id)] = doc
        return doc

    def get_agent_module_memory(self, user_id: str, conversation_id: str, memory_id: str):
        return self.memories.get((user_id, conversation_id, memory_id))

    def get_latest_agent_module_memory(self, user_id: str, conversation_id: str, module: str):
        candidates = [
            memory
            for (memory_user, memory_conversation, _), memory in self.memories.items()
            if memory_user == user_id and memory_conversation == conversation_id and memory["module"] == module
        ]
        return candidates[-1] if candidates else None

    def list_agent_module_memories(self, user_id: str, conversation_id: str, module: str, limit: int = 50):
        return [
            memory
            for (memory_user, memory_conversation, _), memory in self.memories.items()
            if memory_user == user_id and memory_conversation == conversation_id and memory["module"] == module
        ][:limit]

    def delete_agent_chat_conversation(self, user_id: str, conversation_id: str):
        deleted = self.conversations.pop((user_id, conversation_id), None) is not None
        self.messages = [
            message
            for message in self.messages
            if not (message["user_id"] == user_id and message["conversation_id"] == conversation_id)
        ]
        self.memories = {
            key: memory
            for key, memory in self.memories.items()
            if not (key[0] == user_id and key[1] == conversation_id)
        }
        return deleted


class FakePersonaService:
    async def analyze(self, user_id: str, basic_info: dict, persist: bool = True, agent_debug=None):
        return {
            "data": {
                "persona": {"name": "平价美妆测评博主", "description": "真实测评平价好物"},
                "niche": {"primary": "美妆测评"},
                "audience": ["新手化妆人群"],
                "contentStyle": ["真实", "避坑"],
                "structuredResult": {
                    "persona": {"name": "平价美妆测评博主", "description": "真实测评平价好物"},
                    "niche": {"primary": "美妆测评"},
                    "audience": ["新手化妆人群"],
                    "contentStyle": ["真实", "避坑"],
                },
            },
            "warnings": [],
        }

    async def follow_up(self, *args, **kwargs):
        return await self.analyze(args[0], {})


class FakeTrendService:
    async def track(self, user_id: str, preference: str, **kwargs):
        return {
            "data": {
                "discussionOnly": False,
                "completeAnalysis": {
                    "trackName": "新手通勤妆",
                    "trends": "平价底妆和快速出门妆持续升温",
                    "audience": "新手想要低成本、少踩坑的教程",
                    "topics": ["新手通勤妆5分钟出门", "百元彩妆清单"],
                },
                "text": "我整理了一版适合你人设的热门选题。",
            },
            "warnings": [],
        }


class FakeContentService:
    async def draft(self, user_id: str, topic: str, instruction: str, **kwargs):
        return {
            "data": {
                "discussionOnly": False,
                "completeDraft": {
                    "title": "新手通勤妆5分钟出门",
                    "intro": "早八赶时间也不用乱涂。",
                    "body": ["先压一层轻薄底妆", "再用同色系眼影快速提气色"],
                    "ending": "你早上化妆最赶的是哪一步？",
                    "tags": ["通勤妆", "平价彩妆"],
                },
                "text": "推荐标题：新手通勤妆5分钟出门",
            },
            "warnings": [],
        }


def build_service(memory=None):
    return UnifiedAgentChatService(
        memory_crud=memory or FakeMemoryCRUD(),
        persona_service=FakePersonaService(),
        trend_service=FakeTrendService(),
        content_service=FakeContentService(),
    )


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_new_conversation_creates_persona_memory_and_messages():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    response = await service.chat(user_id="user-a", message="我是美妆博主，想写小红书")

    assert response["conversation_id"].startswith("conv_")
    assert response["current_step"] == "persona"
    assert response["next_step"] == "trending"
    assert response["summary"]["persona"]["done"] is True
    assert response["summary"]["persona"]["message_id"] == response["assistant_message"]["id"]
    assert len(memory.messages) == 2


@pytest.mark.anyio
async def test_progresses_to_trending_after_persona_exists():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    second = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        message="帮我追一下适合的热门选题",
    )

    assert second["current_step"] == "trending"
    assert second["next_step"] == "content"
    assert second["summary"]["trending"]["done"] is True


@pytest.mark.anyio
async def test_progresses_to_content_and_binds_parent_memories():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    second = await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="推荐选题")
    third = await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="帮我写正文")

    assert third["current_step"] == "content"
    assert third["next_step"] is None
    content_memory = memory.get_agent_module_memory(
        "user-a",
        first["conversation_id"],
        third["memory_refs"]["content_memory_id"],
    )
    assert content_memory["parent_refs"] == {
        "persona_memory_id": first["memory_refs"]["persona_memory_id"],
        "trending_memory_id": second["memory_refs"]["trending_memory_id"],
    }
    assert third["summary"]["content"]["items"][0]["memory_id"] == third["memory_refs"]["content_memory_id"]


@pytest.mark.anyio
async def test_new_content_request_keeps_previous_content_items():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="推荐选题")
    first_content = await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="帮我写正文")
    second_content = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        message="再写一篇新的",
    )

    items = second_content["summary"]["content"]["items"]
    assert len(items) == 2
    assert items[0]["memory_id"] == first_content["memory_refs"]["content_memory_id"]
    assert items[0]["message_id"] == first_content["assistant_message"]["id"]
    assert items[0]["active"] is False
    assert items[1]["memory_id"] == second_content["memory_refs"]["content_memory_id"]
    assert items[1]["message_id"] == second_content["assistant_message"]["id"]
    assert items[1]["active"] is True
    assert first_content["memory_refs"]["content_memory_id"] != second_content["memory_refs"]["content_memory_id"]


@pytest.mark.anyio
async def test_conversation_detail_returns_messages_and_content_items():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="推荐选题")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="帮我写正文")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="再写一篇新的")

    detail = service.get_conversation(user_id="user-a", conversation_id=first["conversation_id"])

    assert detail is not None
    assert detail["conversation_id"] == first["conversation_id"]
    assert len(detail["messages"]) == 8
    assert len(detail["summary"]["content"]["items"]) == 2
    assert detail["summary"]["content"]["items"][1]["active"] is True


@pytest.mark.anyio
async def test_explicit_persona_change_overrides_content_step():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="推荐选题")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="帮我写正文")
    response = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="content",
        message="我想换人设，改成贵妇护肤",
    )

    assert response["current_step"] == "persona"
    assert response["next_step"] == "trending"
    assert response["conversation_id"] != first["conversation_id"]
    old_conversation = memory.get_agent_chat_conversation("user-a", first["conversation_id"])
    assert old_conversation["active_trending_memory_id"] is not None
    assert old_conversation["active_content_memory_id"] is not None


@pytest.mark.anyio
async def test_user_memory_isolated_by_user_id():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    user_a = await service.chat(user_id="user-a", conversation_id="conv_shared", message="我是美妆博主")
    user_b = await service.chat(user_id="user-b", conversation_id="conv_shared", message="我是健身博主")

    assert user_a["memory_refs"]["persona_memory_id"] != user_b["memory_refs"]["persona_memory_id"]
    assert len(memory.list_agent_chat_messages("user-a", "conv_shared")) == 2
    assert len(memory.list_agent_chat_messages("user-b", "conv_shared")) == 2


@pytest.mark.anyio
async def test_conversation_history_is_named_by_persona_summary():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    history = service.list_conversations(user_id="user-a")

    assert first["conversation_title"]
    assert history["conversations"][0]["title"] == first["conversation_title"]
    assert "真实测评平价好物" in history["conversations"][0]["title"]


@pytest.mark.anyio
async def test_delete_conversation_removes_messages_and_memories():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], message="推荐选题")

    response = service.delete_conversation(user_id="user-a", conversation_id=first["conversation_id"])

    assert response["data"]["deleted"] is True
    assert memory.get_agent_chat_conversation("user-a", first["conversation_id"]) is None
    assert memory.list_agent_chat_messages("user-a", first["conversation_id"]) == []
