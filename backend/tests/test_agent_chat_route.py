from __future__ import annotations

from fastapi.testclient import TestClient

try:
    from backend.app.endpoints.web import agent_chat as agent_chat_endpoint
    from backend.app.main import app
    from backend.app.services.auth import AuthenticatedUser, get_current_user
except ModuleNotFoundError:
    from app.endpoints.web import agent_chat as agent_chat_endpoint
    from app.main import app
    from app.services.auth import AuthenticatedUser, get_current_user

client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_agent_chat_route_uses_demo_user_without_login(monkeypatch):
    captured = {}

    async def fake_chat(**kwargs):
        captured.update(kwargs)
        return {
            "conversation_id": "conv_001",
            "assistant_message": {
                "id": "msg_001",
                "role": "assistant",
                "content": "好的，我们先做人设。",
                "created_at": "2026-07-20T10:30:00+08:00",
            },
            "current_step": "persona",
            "next_step": "trending",
            "summary": {},
            "memory_refs": {},
        }

    monkeypatch.setattr(agent_chat_endpoint.service, "chat", fake_chat)

    response = client.post("/api/agent/chat", json={"message": "我是美妆博主"})

    assert response.status_code == 200
    assert response.json()["conversation_id"] == "conv_001"
    assert captured["user_id"] == "demo-user"
    assert captured["message"] == "我是美妆博主"


def test_agent_chat_route_prefers_logged_in_user(monkeypatch):
    captured = {}

    async def fake_chat(**kwargs):
        captured.update(kwargs)
        return {
            "conversation_id": kwargs["conversation_id"],
            "assistant_message": {
                "id": "msg_001",
                "role": "assistant",
                "content": "继续做热门追踪。",
                "created_at": "2026-07-20T10:30:00+08:00",
            },
            "current_step": "trending",
            "next_step": "content",
            "summary": {},
            "memory_refs": {},
        }

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="session-user", username="tester")
    monkeypatch.setattr(agent_chat_endpoint.service, "chat", fake_chat)

    response = client.post(
        "/api/agent/chat",
        json={
            "conversation_id": "conv_abc",
            "message": "推荐选题",
            "current_step": "trending",
            "selected_persona_id": "persona_001",
            "selected_topic_id": "topic_001",
            "expose_debug": True,
        },
    )

    assert response.status_code == 200
    assert captured["user_id"] == "session-user"
    assert captured["conversation_id"] == "conv_abc"
    assert captured["selected_persona_id"] == "persona_001"
    assert captured["selected_topic_id"] == "topic_001"
    assert captured["expose_debug"] is True


def test_agent_chat_conversations_route_uses_logged_in_user(monkeypatch):
    captured = {}

    def fake_list_conversations(**kwargs):
        captured.update(kwargs)
        return {
            "conversations": [
                {
                    "conversation_id": "conv_001",
                    "title": "平价美妆测评",
                    "current_step": "trending",
                    "summary": {},
                    "memory_refs": {},
                    "updated_at": "2026-07-20T10:30:00+08:00",
                }
            ]
        }

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="session-user", username="tester")
    monkeypatch.setattr(agent_chat_endpoint.service, "list_conversations", fake_list_conversations)

    response = client.get("/api/agent/conversations?limit=20")

    assert response.status_code == 200
    assert response.json()["conversations"][0]["title"] == "平价美妆测评"
    assert captured == {"user_id": "session-user", "limit": 20}


def test_agent_chat_conversation_detail_route_returns_history(monkeypatch):
    captured = {}

    def fake_get_conversation(**kwargs):
        captured.update(kwargs)
        return {
            "conversation_id": kwargs["conversation_id"],
            "conversation_title": "平价美妆测评",
            "current_step": "done",
            "messages": [
                {
                    "id": "msg_001",
                    "role": "assistant",
                    "content": "推荐标题：新手通勤妆5分钟出门",
                    "step": "content",
                    "created_at": "2026-07-20T10:30:00+08:00",
                }
            ],
            "summary": {
                "content": {
                    "done": True,
                    "title": "内容撰写",
                    "text": "新手通勤妆5分钟出门",
                    "message_id": "msg_001",
                    "memory_id": "content_001",
                    "items": [
                        {
                            "memory_id": "content_001",
                            "title": "新手通勤妆5分钟出门",
                            "text": "新手通勤妆5分钟出门",
                            "message_id": "msg_001",
                            "active": True,
                            "created_at": "2026-07-20T10:30:00+08:00",
                        }
                    ],
                }
            },
            "memory_refs": {"content_memory_id": "content_001"},
        }

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="session-user", username="tester")
    monkeypatch.setattr(agent_chat_endpoint.service, "get_conversation", fake_get_conversation)

    response = client.get("/api/agent/conversations/conv_001")

    assert response.status_code == 200
    assert response.json()["summary"]["content"]["items"][0]["message_id"] == "msg_001"
    assert captured == {"user_id": "session-user", "conversation_id": "conv_001"}


def test_agent_chat_conversation_detail_route_returns_404(monkeypatch):
    monkeypatch.setattr(agent_chat_endpoint.service, "get_conversation", lambda **kwargs: None)

    response = client.get("/api/agent/conversations/missing")

    assert response.status_code == 404
