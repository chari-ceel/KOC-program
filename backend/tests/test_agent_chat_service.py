from __future__ import annotations

from datetime import datetime, timedelta

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

    def save_agent_chat_message(
        self,
        *,
        user_id: str,
        conversation_id: str,
        role: str,
        content: str,
        step: str,
        message_id=None,
        question_blocks=None,
        copy_payload=None,
    ):
        doc = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "message_id": message_id or f"msg_{len(self.messages) + 1}",
            "role": role,
            "content": content,
            "step": step,
            "created_at": datetime.utcnow(),
        }
        if question_blocks:
            doc["question_blocks"] = question_blocks
        if copy_payload:
            doc["copy_payload"] = copy_payload
        self.messages.append(doc)
        return doc

    def update_agent_chat_message(self, user_id: str, conversation_id: str, message_id: str, payload: dict):
        for message in self.messages:
            if (
                message["user_id"] == user_id
                and message["conversation_id"] == conversation_id
                and message["message_id"] == message_id
            ):
                message.update({key: value for key, value in payload.items() if key in {"question_blocks", "copy_payload"}})
                return message
        return {}

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

    def delete_empty_agent_chat_conversations(self, user_id: str):
        legacy_cutoff = datetime.utcnow() - timedelta(minutes=5)
        pending_cutoff = datetime.utcnow() - timedelta(minutes=30)
        deleted_count = 0
        for (conversation_user, conversation_id), conversation in list(self.conversations.items()):
            if conversation_user != user_id:
                continue
            if conversation.get("title") not in {"新建对话", "新的创作对话"}:
                continue
            if any(conversation.get(key) for key in ("active_persona_memory_id", "active_trending_memory_id", "active_content_memory_id")):
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
            has_user_message = any(
                message["user_id"] == user_id and message["conversation_id"] == conversation_id and message["role"] == "user"
                for message in self.messages
            )
            has_module_memory = any(key[0] == user_id and key[1] == conversation_id for key in self.memories)
            if has_user_message or has_module_memory:
                continue
            if self.delete_agent_chat_conversation(user_id, conversation_id):
                deleted_count += 1
        return deleted_count


class FakePersonaService:
    def __init__(self) -> None:
        self.saved_records = {
            "persona_record_1": {
                "id": "persona_record_1",
                "persona": {
                    "title": "新人职场日记",
                    "persona": {"name": "新人职场日记", "description": "分享职场新人从入职踩坑到快速上手的真实日常"},
                    "niche": {"primary": "职场成长"},
                    "audience": ["即将毕业的应届生", "入职不满1年的职场新人"],
                    "contentStyle": ["真实踩坑记录风", "像和同届朋友唠嗑"],
                },
            }
        }

    async def analyze(self, user_id: str, basic_info: dict, persist: bool = True, agent_debug=None, prompt_override=None):
        return {
            "data": {
                "isReadyToSave": True,
                "persona": {"name": "平价美妆测评博主", "description": "真实测评平价好物"},
                "niche": {"primary": "美妆测评"},
                "audience": ["新手化妆人群"],
                "contentStyle": ["真实", "避坑"],
                "followUpQuestions": ["你想重点测评哪类平价好物？", "你最想帮新手避开什么坑？", "你平时方便拍哪些真实使用场景？"],
                "structuredResult": {
                    "persona": {"name": "平价美妆测评博主", "description": "真实测评平价好物"},
                    "niche": {"primary": "美妆测评"},
                    "audience": ["新手化妆人群"],
                    "contentStyle": ["真实", "避坑"],
                    "followUpQuestions": ["你想重点测评哪类平价好物？", "你最想帮新手避开什么坑？", "你平时方便拍哪些真实使用场景？"],
                },
            },
            "warnings": [],
        }

    async def follow_up(self, *args, **kwargs):
        return await self.analyze(args[0], {})

    def save_persona(self, user_id: str, persona_data: dict, collection_name: str = "personas"):
        return {"status": "success", "data": persona_data, "record": {"id": "saved_persona", "persona": persona_data}}

    def get_persona_record(self, user_id: str, record_id: str):
        return self.saved_records.get(record_id, {})


class FakeTrendService:
    async def track(self, user_id: str, preference: str, **kwargs):
        return {
            "data": {
                "discussionOnly": False,
                "completeAnalysis": {
                    "trackName": "新手通勤妆",
                    "trends": "平价底妆和快速出门妆持续升温",
                    "audience": "新手想要低成本、少踩坑的教程",
                    "topics": ["新手通勤妆", "百元彩妆清单", "底妆避坑指南"],
                },
                "text": "我整理了一版适合你人设的热门选题。",
            },
            "warnings": [],
        }


def test_trend_reply_restores_complete_report_from_compact_payload():
    service = build_service()
    text = service._trend_reply(
        {"text": "我整理了一版适合你人设的热门选题。"},
        {
            "trackName": "成年娃妈观念碰撞分享",
            "trends": "成年娃亲子关系从管教转向边界沟通，适合写真实经验和避坑清单",
            "audience": "妈妈们想知道相处怎么更稳、怎么少吵架、怎么把关心说得不压迫",
            "topics": ["成年娃亲子相处新手先看这篇", "成年娃亲子相处真实避坑清单", "成年娃亲子相处怎么开始更稳"],
        },
    )

    assert "**趋势维度：**" in text
    assert "**趋势总结：**" in text
    assert "**当前热点包括：**" in text
    assert "**受众需求：**" in text
    assert "**推荐选题：**" in text
    assert "成年娃亲子相处真实避坑清单" in text


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

    def save_draft_record(self, user_id: str, draft_data: dict):
        return {"status": "success", "data": draft_data, "record": {"id": "saved_content", "draft": draft_data}}


def build_service(memory=None):
    return UnifiedAgentChatService(
        memory_crud=memory or FakeMemoryCRUD(),
        persona_service=FakePersonaService(),
        trend_service=FakeTrendService(),
        content_service=FakeContentService(),
    )


async def approve_persona(service: UnifiedAgentChatService, user_id: str, conversation_id: str):
    return await service.chat(
        user_id=user_id,
        conversation_id=conversation_id,
        current_step="persona",
        message="满意，进入热门追踪",
        action_type="approve_step",
        action_payload={"step": "persona"},
    )


async def create_trend(service: UnifiedAgentChatService, user_id: str, conversation_id: str):
    return await service.chat(
        user_id=user_id,
        conversation_id=conversation_id,
        current_step="trending",
        message="帮我追一下适合的热门选题",
    )


async def choose_first_topic(service: UnifiedAgentChatService, user_id: str, conversation_id: str, trend_response: dict):
    title = trend_response["question_blocks"][0]["question"]
    return await service.chat(
        user_id=user_id,
        conversation_id=conversation_id,
        current_step="trending",
        message=title,
        action_type="choose_topic",
        action_payload={"title": title},
    )


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_create_conversation_returns_welcome_questions():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    detail = await service.create_conversation(user_id="user-a")

    assert detail["conversation_id"].startswith("conv_")
    assert detail["current_step"] == "persona"
    assert detail["create_status"] == "ready"
    assert len(detail["messages"]) == 1
    assert detail["messages"][0]["role"] == "assistant"
    assert [block["id"] for block in detail["question_blocks"]] == [
        "persona_starter_1",
        "persona_starter_2",
        "persona_starter_3",
    ]
    assert "身份" in detail["question_blocks"][0]["question"]
    assert "爱好" in detail["question_blocks"][1]["question"]
    assert "擅长" in detail["question_blocks"][2]["question"]
    assert all(block["examples"] == [] for block in detail["question_blocks"])
    assert detail["messages"][0]["question_blocks"] == detail["question_blocks"]
    conversation = memory.get_agent_chat_conversation("user-a", detail["conversation_id"])
    assert len(conversation["current_persona_question_blocks"]) == 3
    assert len(conversation["shown_persona_question_signatures"]) == 3


def test_persona_question_examples_are_hidden_when_question_has_inline_example():
    service = build_service(FakeMemoryCRUD())

    examples = service._persona_question_examples("你最方便拍哪些真实素材（比如：工位、通勤路、宿舍桌面）？", "")

    assert examples == []


@pytest.mark.anyio
async def test_create_conversation_rolls_back_when_detail_fails(monkeypatch):
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    monkeypatch.setattr(service, "get_conversation", lambda **kwargs: None)

    with pytest.raises(RuntimeError):
        await service.create_conversation(user_id="user-a")

    assert memory.conversations == {}
    assert memory.messages == []


def test_list_conversations_cleans_empty_shells_only():
    memory = FakeMemoryCRUD()
    service = build_service(memory)
    memory.upsert_agent_chat_conversation(
        "user-a",
        "empty",
        {
            "title": "新建对话",
            "current_step": "persona",
            "active_persona_memory_id": None,
            "active_trending_memory_id": None,
            "active_content_memory_id": None,
            "create_status": "creating",
        },
    )
    memory.save_agent_chat_message(user_id="user-a", conversation_id="empty", role="assistant", content="欢迎", step="persona")
    memory.conversations[("user-a", "empty")]["created_at"] = datetime.utcnow() - timedelta(minutes=10)
    memory.upsert_agent_chat_conversation(
        "user-a",
        "real",
        {
            "title": "新建对话",
            "current_step": "persona",
            "active_persona_memory_id": None,
            "active_trending_memory_id": None,
            "active_content_memory_id": None,
            "create_status": "creating",
        },
    )
    memory.save_agent_chat_message(user_id="user-a", conversation_id="real", role="assistant", content="欢迎", step="persona")
    memory.save_agent_chat_message(user_id="user-a", conversation_id="real", role="user", content="我是学生", step="persona")
    memory.upsert_agent_chat_conversation(
        "user-a",
        "pending",
        {
            "title": "新建对话",
            "current_step": "persona",
            "active_persona_memory_id": None,
            "active_trending_memory_id": None,
            "active_content_memory_id": None,
            "create_status": "questions_pending",
        },
    )
    memory.save_agent_chat_message(user_id="user-a", conversation_id="pending", role="assistant", content="欢迎", step="persona")

    listed = service.list_conversations(user_id="user-a")

    assert [item["conversation_id"] for item in listed["conversations"]] == ["real", "pending"]
    assert memory.get_agent_chat_conversation("user-a", "empty") is None
    assert memory.get_agent_chat_conversation("user-a", "real") is not None
    assert memory.get_agent_chat_conversation("user-a", "pending") is not None


@pytest.mark.anyio
async def test_new_conversation_creates_persona_memory_and_messages():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    response = await service.chat(user_id="user-a", message="我是美妆博主，想写小红书")

    assert response["conversation_id"].startswith("conv_")
    assert response["current_step"] == "persona"
    assert response["next_step"] == "persona"
    assert response["summary"]["persona"]["done"] is False
    assert response["summary"]["persona"]["message_id"] == response["assistant_message"]["id"]
    assert response["readiness"]["persona"] == "ready_for_approval"
    assert response["actions"][0]["action_type"] == "approve_step"
    assert len(memory.messages) == 2


@pytest.mark.anyio
async def test_progresses_to_trending_after_persona_exists():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    second = await approve_persona(service, "user-a", first["conversation_id"])

    assert second["current_step"] == "persona"
    assert second["next_step"] == "trending"
    assert second["summary"]["persona"]["done"] is True


@pytest.mark.anyio
async def test_save_persona_marks_done_and_moves_to_trending():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    saved = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="persona",
        message="保存当前结果",
        action_type="save",
    )

    assert saved["summary"]["persona"]["done"] is True
    assert saved["next_step"] == "trending"
    assert saved["question_blocks"] == []
    assert "人设打造完毕" in saved["assistant_message"]["content"]
    conversation = memory.get_agent_chat_conversation("user-a", first["conversation_id"])
    assert conversation["current_step"] == "trending"


def test_start_conversation_from_persona_history_starts_at_trending():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    detail = service.start_conversation_from_persona(user_id="user-a", persona_record_id="persona_record_1")

    assert detail is not None
    assert detail["current_step"] == "trending"
    assert detail["summary"]["persona"]["done"] is True
    assert detail["summary"]["persona"]["text"] == "新人职场日记"
    assert detail["question_blocks"] == []
    assert "热门方向" in detail["messages"][0]["content"]


def test_start_conversation_from_same_persona_creates_isolated_tasks():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = service.start_conversation_from_persona(user_id="user-a", persona_record_id="persona_record_1")
    second = service.start_conversation_from_persona(user_id="user-a", persona_record_id="persona_record_1")

    assert first is not None and second is not None
    assert first["conversation_id"] != second["conversation_id"]
    assert first["summary"]["persona"]["done"] is True
    assert second["summary"]["persona"]["done"] is True
    assert second["summary"]["trending"]["done"] is False
    assert second["summary"]["content"]["done"] is False
    assert second["memory_refs"]["trending_memory_id"] is None
    assert second["memory_refs"]["content_memory_id"] is None
    first_messages = memory.list_agent_chat_messages("user-a", first["conversation_id"])
    second_messages = memory.list_agent_chat_messages("user-a", second["conversation_id"])
    assert len(first_messages) == 1
    assert len(second_messages) == 1
    assert first_messages[0]["message_id"] != second_messages[0]["message_id"]


def test_answered_persona_question_is_filtered():
    service = build_service()

    questions = service._persona_questions(
        {},
        {
            "questions": ["你现在是什么身份或阶段？", "你平时最感兴趣、最愿意聊的是什么？"],
            "history_messages": [{"role": "user", "content": "身份/阶段：刚入职的职场新人"}],
        },
    )

    assert "你现在是什么身份或阶段？" not in questions
    assert "你平时最感兴趣、最愿意聊的是什么？" in questions


def test_persona_follow_up_refills_three_layered_questions_without_reusing_shown_cards():
    service = build_service()
    shown_questions = [
        "你现在是什么身份或阶段？",
        "你平时最感兴趣、最愿意聊的是什么？",
        "你觉得自己比较擅长分享什么？",
    ]

    questions = service._persona_questions(
        {},
        {
            "questions": shown_questions,
            "history_messages": [{"role": "user", "content": "身份/阶段：我是大学生，想记录上课碎片和宿舍日常"}],
            "shown_persona_question_signatures": [service._question_signature(question) for question in shown_questions],
        },
    )

    assert questions == []


def test_persona_follow_up_does_not_repeat_first_round_after_game_interest_answer():
    service = build_service()
    shown_questions = [
        "你现在是什么身份或阶段？",
        "你平时最感兴趣、最愿意聊的是什么？",
        "你觉得自己比较擅长分享什么？",
    ]

    questions = service._persona_questions(
        {},
        {
            "questions": shown_questions,
            "history_messages": [{"role": "user", "content": "你平时最感兴趣、最愿意聊的是什么？: 我喜欢乙游，尤其是恋与深空和卡面"}],
            "shown_persona_questions": shown_questions,
            "shown_persona_question_signatures": [service._question_signature(question) for question in shown_questions],
            "shown_persona_question_keys": [service._persona_question_semantic_key(question) for question in shown_questions],
        },
    )

    assert questions == []


def test_persona_quality_gate_rejects_short_drama_clothing_question():
    service = build_service()

    questions, reasons = service._validate_persona_agent_questions(
        ["你喜欢看哪类短剧？", "你穿什么风格的衣服？", "你想吸引什么受众？"],
        {},
        {"history_messages": [{"role": "user", "content": "我喜欢看短剧，想做爽剧吐槽"}]},
    )

    assert len(questions) < 3
    assert any("短剧" in reason for reason in reasons)


def test_persona_quality_gate_accepts_three_agent_generated_short_drama_questions():
    service = build_service()

    questions, reasons = service._validate_persona_agent_questions(
        [
            "哪类短剧爽点最能让你想立刻分享，比如反杀、复仇还是先婚后爱？",
            "你更想用吐槽口吻、安利口吻，还是追剧搭子的碎碎念来讲？",
            "你平时会从哪里整理短剧素材和片名信息，截图、平台榜单还是观后感笔记？",
        ],
        {},
        {"history_messages": [{"role": "user", "content": "我喜欢看短剧，想做爽剧吐槽"}]},
    )

    assert questions == [
        "哪类短剧爽点最能让你想立刻分享，比如反杀、复仇还是先婚后爱？",
        "你更想用吐槽口吻、安利口吻，还是追剧搭子的碎碎念来讲？",
        "你平时会从哪里整理短剧素材和片名信息，截图、平台榜单还是观后感笔记？",
    ]
    assert not reasons


def test_persona_recovery_questions_are_generic_after_agent_retry_failure():
    service = build_service()

    questions = service._persona_recovery_questions(
        "我喜欢看修仙文，想做网文吐槽",
        {
            "history_messages": [{"role": "user", "content": "我喜欢看修仙文，想做网文吐槽"}],
            "shown_persona_questions": [],
            "shown_persona_question_signatures": [],
            "shown_persona_question_keys": [],
        },
        {"persona": None, "trending": None, "content": None},
    )

    assert questions == [
        "你现在是什么身份或阶段？比如学生、职场新人、宝妈、自由职业都可以说",
        "你最愿意长期聊什么？比如爱好、生活经验、学习工作、喜欢的内容都可以",
        "你更想分享哪类内容？比如测评、清单、避坑、教程、真实日常都可以",
    ]
    assert not any("修仙" in question or "短剧" in question or "cos" in question for question in questions)
    assert not any("穿搭" in question or "美妆" in question for question in questions)


def test_persona_recovery_reply_does_not_expose_internal_failure_terms():
    service = build_service()

    reply = service._persona_recovery_reply(
        "我喜欢 cos",
        {"history_messages": [{"role": "user", "content": "我喜欢 cos"}]},
        ["少于 3 个问题", "过滤重复、已回答或无效问题后不足 3 个"],
    )

    assert "我换一种更好回答的方式问你" in reply
    forbidden = ("质量检查", "不合格", "被拦下", "Agent 没有生成", "fallback", "内部失败")
    assert not any(term in reply for term in forbidden)


def test_shown_persona_questions_include_current_blocks_for_old_conversations():
    service = build_service()
    conversation = {
        "current_persona_question_blocks": [
            {"question": "你现在是什么身份或阶段？"},
            {"question": "你平时最感兴趣、最愿意聊的是什么？"},
        ],
    }

    assert "你现在是什么身份或阶段？" in service._shown_persona_questions(conversation)
    assert service._question_signature("你平时最感兴趣、最愿意聊的是什么？") in service._shown_persona_question_signatures(conversation)
    assert "starter_interest" in service._shown_persona_question_keys(conversation)


@pytest.mark.anyio
async def test_persona_reply_includes_save_hint_each_round():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    response = await service.chat(user_id="user-a", message="我是美妆博主")

    assert "也可以点保存人设" in response["assistant_message"]["content"]
    assert "热门追踪" in response["assistant_message"]["content"]


def test_persona_reply_bolds_summary_labels():
    service = build_service()

    reply = service._persona_reply(
        {"reply": "人设标题：乙游卡面日记\n内容方向：乙游卡面测评\n目标受众：同坑玩家\n内容风格：真实碎碎念"},
        {},
    )

    assert "**人设标题：**" in reply
    assert "**内容方向：**" in reply
    assert "**目标受众：**" in reply
    assert "**内容风格：**" in reply



@pytest.mark.anyio
async def test_progresses_to_content_and_binds_parent_memories():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    second = await create_trend(service, "user-a", first["conversation_id"])
    third = await choose_first_topic(service, "user-a", first["conversation_id"], second)

    assert third["current_step"] == "content"
    assert third["next_step"] == "content"
    assert third["summary"]["trending"]["done"] is True
    assert third["summary"]["content"]["done"] is False
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
async def test_trending_topics_are_question_blocks_and_choose_topic_uses_current_task_memory():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    task = service.start_conversation_from_persona(user_id="user-a", persona_record_id="persona_record_1")
    assert task is not None
    trend = await create_trend(service, "user-a", task["conversation_id"])

    assert [block["action_type"] for block in trend["question_blocks"]] == ["choose_topic", "choose_topic", "choose_topic"]
    assert trend["actions"][0]["action_type"] == "quick_reply"

    content = await service.chat(
        user_id="user-a",
        conversation_id=task["conversation_id"],
        current_step="trending",
        message=trend["question_blocks"][1]["question"],
        action_type="choose_topic",
        action_payload=trend["question_blocks"][1]["action_payload"],
    )

    content_memory = memory.get_agent_module_memory(
        "user-a",
        task["conversation_id"],
        content["memory_refs"]["content_memory_id"],
    )
    assert content["current_step"] == "content"
    assert content_memory["parent_refs"]["trending_memory_id"] == trend["memory_refs"]["trending_memory_id"]


@pytest.mark.anyio
async def test_save_trending_marks_done_and_moves_to_content():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    await create_trend(service, "user-a", first["conversation_id"])
    saved = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="trending",
        message="保存当前结果",
        action_type="save",
    )

    assert saved["summary"]["trending"]["done"] is True
    assert saved["next_step"] == "content"
    assert "热门追踪已确认" in saved["assistant_message"]["content"]
    conversation = memory.get_agent_chat_conversation("user-a", first["conversation_id"])
    assert conversation["current_step"] == "content"


@pytest.mark.anyio
async def test_save_content_marks_task_done_and_updates_title():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    trend = await create_trend(service, "user-a", first["conversation_id"])
    await choose_first_topic(service, "user-a", first["conversation_id"], trend)
    saved = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="content",
        message="保存当前结果",
        action_type="save",
    )

    assert saved["summary"]["content"]["done"] is True
    assert saved["next_step"] is None
    assert saved["assistant_message"] is None
    assert "**" not in saved["copy_payload"]["publish_text"]
    conversation = memory.get_agent_chat_conversation("user-a", first["conversation_id"])
    assert conversation["current_step"] == "done"
    assert conversation["title"] == "新手通勤妆5分钟出门"


@pytest.mark.anyio
async def test_new_content_request_keeps_previous_content_items():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    trend = await create_trend(service, "user-a", first["conversation_id"])
    first_content = await choose_first_topic(service, "user-a", first["conversation_id"], trend)
    second_content = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="content",
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
    await approve_persona(service, "user-a", first["conversation_id"])
    trend = await create_trend(service, "user-a", first["conversation_id"])
    await choose_first_topic(service, "user-a", first["conversation_id"], trend)
    await service.chat(user_id="user-a", conversation_id=first["conversation_id"], current_step="content", message="再写一篇新的")

    detail = service.get_conversation(user_id="user-a", conversation_id=first["conversation_id"])

    assert detail is not None
    assert detail["conversation_id"] == first["conversation_id"]
    assert len(detail["messages"]) == 9
    assert len(detail["summary"]["content"]["items"]) == 2
    assert detail["summary"]["content"]["items"][1]["active"] is True


@pytest.mark.anyio
async def test_explicit_persona_change_overrides_content_step():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    trend = await create_trend(service, "user-a", first["conversation_id"])
    await choose_first_topic(service, "user-a", first["conversation_id"], trend)
    response = await service.chat(
        user_id="user-a",
        conversation_id=first["conversation_id"],
        current_step="content",
        message="我想换人设，改成贵妇护肤",
    )

    assert response["current_step"] == "persona"
    assert response["next_step"] == "persona"
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
    assert "平价美妆测评博主" in history["conversations"][0]["title"]


@pytest.mark.anyio
async def test_delete_conversation_removes_messages_and_memories():
    memory = FakeMemoryCRUD()
    service = build_service(memory)

    first = await service.chat(user_id="user-a", message="我是美妆博主")
    await approve_persona(service, "user-a", first["conversation_id"])
    await create_trend(service, "user-a", first["conversation_id"])

    response = service.delete_conversation(user_id="user-a", conversation_id=first["conversation_id"])

    assert response["data"]["deleted"] is True
    assert memory.get_agent_chat_conversation("user-a", first["conversation_id"]) is None
    assert memory.list_agent_chat_messages("user-a", first["conversation_id"]) == []
