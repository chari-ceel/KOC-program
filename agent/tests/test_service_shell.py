from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.workflows.base import BaseWorkflow
from app.runtime.gemini_runtime import GeminiRuntime


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "koc-agent"


def test_agent_tasks_endpoint() -> None:
    response = client.get("/agent/tasks")
    body = response.json()

    assert response.status_code == 200
    assert "general.chat" in body["tasks"]
    assert "persona.analyze" in body["tasks"]
    assert "content.revise" in body["tasks"]
    assert "context.plan" in body["reservedTasks"]


def test_agent_tools_endpoint() -> None:
    response = client.get("/agent/tools")
    body = response.json()

    assert response.status_code == 200
    retrieval_tool = body["tools"][0]
    sources = {source["source"]: source for source in retrieval_tool["sources"]}

    assert retrieval_tool["toolType"] == "retrieval"
    assert sources["xhs_fetcher"]["role"] == "primary"
    assert sources["xhs_fetcher"]["status"] in {"available", "needs_auth", "needs_config", "disabled", "failed"}
    assert sources["web_search"]["role"] == "fallback"
    assert "mock_retrieval" not in sources


def test_prompt_lab_page_is_served() -> None:
    response = client.get("/prompt-lab")

    assert response.status_code == 200
    assert "KOC Prompt Lab" in response.text
    assert "/debug/model/prompt-lab" in response.text


def test_debug_page_alias_serves_prompt_lab() -> None:
    response = client.get("/debug")

    assert response.status_code == 200
    assert "KOC Prompt Lab" in response.text
    assert "/debug/model/prompt-lab" in response.text


def test_agent_run_routes_to_workflow() -> None:
    response = client.post(
        "/agent/run",
        json={
            "requestId": "req_test_001",
            "taskType": "content.draft",
            "platform": "xiaohongshu",
            "userId": "demo-user",
            "input": {},
            "context": {},
            "options": {},
        },
    )
    body = response.json()

    assert response.status_code == 200
    assert body["requestId"] == "req_test_001"
    assert body["status"] == "failed"
    assert body["error"]["code"] == "MISSING_CONTEXT"


def test_base_workflow_defaults_to_env_runtime_mode(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_RUNTIME_MODE", "model")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    get_settings.cache_clear()

    workflow = BaseWorkflow()

    assert workflow._default_runtime_mode() == "model"
    assert isinstance(workflow._default_model_runtime(), GeminiRuntime)
