from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.endpoints.web import content as content_endpoint
from backend.app.endpoints.web import persona as persona_endpoint
from backend.app.endpoints.web import trends as trends_endpoint
from backend.app.services.auth import AuthenticatedUser, get_current_user, require_current_user


client = TestClient(app)


def _user(user_id: str = "session-user") -> AuthenticatedUser:
    return AuthenticatedUser(user_id=user_id, username=f"{user_id}@test")


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_protected_routes_return_standard_401_without_session() -> None:
    response = client.post(
        "/api/content/draft",
        json={"userId": "attacker", "topic": "大学", "instruction": "写一篇"},
    )

    assert response.status_code == 401
    assert response.json() == {"code": 401, "message": "未登录"}


def test_persona_analyze_allows_guest_and_uses_guest_user(monkeypatch) -> None:
    captured = {}

    async def fake_analyze(user_id: str, basic_info: dict, **kwargs) -> dict:
        captured["user_id"] = user_id
        return {"data": {"persona": {"name": "游客体验"}}, "warnings": []}

    monkeypatch.setattr(persona_endpoint.service, "analyze", fake_analyze)

    response = client.post(
        "/api/persona/analyze",
        json={"userId": "attacker", "basicInfo": {"goal": "试用"}},
    )

    assert response.status_code == 200
    assert captured["user_id"] == "guest-user"


def test_business_routes_ignore_body_and_path_user_id(monkeypatch) -> None:
    app.dependency_overrides[require_current_user] = lambda: _user("real-user")
    app.dependency_overrides[get_current_user] = lambda: _user("real-user")
    captured = {}

    async def fake_track(user_id: str, preference: str, **kwargs) -> dict:
        captured["track_user_id"] = user_id
        return {"data": {"discussionOnly": True, "text": "ok", "raw": {}}, "warnings": []}

    def fake_save_draft(user_id: str, draft: dict) -> dict:
        captured["save_draft_user_id"] = user_id
        return {"status": "success", "data": draft}

    def fake_history(user_id: str) -> list:
        captured["history_user_id"] = user_id
        return []

    monkeypatch.setattr(trends_endpoint.service, "track", fake_track)
    monkeypatch.setattr(content_endpoint.service, "save_draft_record", fake_save_draft)
    monkeypatch.setattr(content_endpoint.service, "get_draft_history", fake_history)

    track_response = client.post(
        "/api/trends/track",
        json={"userId": "attacker", "preference": "给我做趋势追踪"},
    )
    save_response = client.post(
        "/api/content/save",
        json={"userId": "attacker", "draft": {"id": "draft-1"}},
    )
    history_response = client.get("/api/content/attacker/history")

    assert track_response.status_code == 200
    assert save_response.status_code == 200
    assert history_response.status_code == 200
    assert captured == {
        "track_user_id": "real-user",
        "save_draft_user_id": "real-user",
        "history_user_id": "real-user",
    }


def test_content_save_normalizes_title_to_structured_note_title(monkeypatch) -> None:
    app.dependency_overrides[require_current_user] = lambda: _user("real-user")
    app.dependency_overrides[get_current_user] = lambda: _user("real-user")
    captured = {}

    def fake_save_draft(user_id: str, draft: dict) -> None:
        captured["user_id"] = user_id
        captured["draft"] = draft

    monkeypatch.setattr(content_endpoint.service.content_crud, "save_draft", fake_save_draft)

    response = client.post(
        "/api/content/save",
        json={
            "draft": {
                "id": "draft-1",
                "title": "用户一开始输入的主题",
                "structured": {
                    "noteTitle": "保存后的笔记标题",
                },
            }
        },
    )

    assert response.status_code == 200
    assert captured["user_id"] == "real-user"
    assert captured["draft"]["title"] == "保存后的笔记标题"
    assert response.json()["data"]["title"] == "保存后的笔记标题"
