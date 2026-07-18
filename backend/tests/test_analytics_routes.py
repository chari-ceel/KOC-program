from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.endpoints.web import analytics as analytics_endpoint
from backend.app.main import app
from backend.app.services.auth import AuthenticatedUser, get_current_user


client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_analytics_event_route_accepts_guest(monkeypatch) -> None:
    captured = {}

    def fake_record_event(**kwargs) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(analytics_endpoint.analytics_service, "record_event", fake_record_event)

    response = client.post(
        "/api/analytics/events",
        json={
            "eventName": "agent_output_copy",
            "module": "content",
            "conversationId": "conversation-1",
            "messageId": "message-1",
            "messageIndex": 3,
            "messageRole": "assistant",
            "contentLength": 1280,
            "copySource": "message_action_button",
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["accepted"] is True
    assert captured["event_name"] == "agent_output_copy"
    assert captured["module"] == "content"
    assert captured["user"] is None
    assert captured["payload"]["conversation_id"] == "conversation-1"


def test_analytics_event_route_uses_session_user(monkeypatch) -> None:
    captured = {}

    def fake_record_event(**kwargs) -> None:
        captured.update(kwargs)

    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(user_id="session-user", username="tester")
    monkeypatch.setattr(analytics_endpoint.analytics_service, "record_event", fake_record_event)

    response = client.post(
        "/api/analytics/events",
        json={
            "eventName": "conversation_turn_completed",
            "module": "profile",
            "conversationId": "conversation-2",
            "requestId": "request-2",
            "taskType": "persona.follow_up",
            "turnIndex": 2,
            "userMessageLength": 18,
            "assistantMessageLength": 56,
            "historyMessageCount": 3,
            "status": "success",
            "latencyMs": 1200,
        },
    )

    assert response.status_code == 200
    assert captured["user"].user_id == "session-user"
    assert captured["payload"]["task_type"] == "persona.follow_up"
    assert captured["payload"]["latency_ms"] == 1200
