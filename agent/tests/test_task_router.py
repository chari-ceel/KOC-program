from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _request(task_type: str, platform: str = "xiaohongshu") -> dict:
    return {
        "requestId": "req_router_001",
        "taskType": task_type,
        "platform": platform,
        "userId": "demo-user",
        "input": {},
        "context": {},
        "options": {},
    }


def test_unknown_task_type_returns_error() -> None:
    response = client.post("/agent/run", json=_request("unknown.task"))
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "failed"
    assert body["error"]["code"] == "UNSUPPORTED_TASK_TYPE"


def test_reserved_task_type_returns_error() -> None:
    response = client.post("/agent/run", json=_request("context.plan"))
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "failed"
    assert body["error"]["code"] == "UNSUPPORTED_TASK_TYPE"


def test_unsupported_platform_returns_error() -> None:
    response = client.post("/agent/run", json=_request("content.draft", "douyin"))
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "failed"
    assert body["error"]["code"] == "UNSUPPORTED_PLATFORM"


def test_general_chat_routes_to_workflow() -> None:
    payload = _request("general.chat")
    payload["input"] = {"userMessage": "你好"}
    response = client.post("/agent/run", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "success"
    assert body["data"]["reply"]
