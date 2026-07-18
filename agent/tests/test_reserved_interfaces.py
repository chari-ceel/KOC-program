from fastapi.testclient import TestClient

from app.core.errors import RESERVED_FEATURE
from app.main import app
from app.tools.agent_memory import AgentMemoryTool
from app.tools.context_provider import ContextProviderTool


client = TestClient(app)


def test_async_job_create_endpoint_is_reserved() -> None:
    response = client.post(
        "/agent/jobs",
        json={
            "requestId": "job_req_001",
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
    assert body["status"] == "reserved"
    assert body["jobId"] is None
    assert body["error"]["code"] == RESERVED_FEATURE
    assert body["metadata"]["syncEndpoint"] == "/agent/run"


def test_async_job_read_endpoint_is_reserved() -> None:
    response = client.get("/agent/jobs/job_001")
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "reserved"
    assert body["jobId"] == "job_001"
    assert body["error"]["code"] == RESERVED_FEATURE


def test_context_provider_tool_is_reserved() -> None:
    result = ContextProviderTool().query_user_context(
        user_id="demo-user",
        fields=["savedPersona", "draftHistory"],
    )

    assert result.status == "reserved"
    assert result.toolType == "context_provider"
    assert result.error.code == RESERVED_FEATURE
    assert result.error.details["fields"] == ["savedPersona", "draftHistory"]


def test_agent_memory_tool_is_reserved() -> None:
    result = AgentMemoryTool().query(user_id="demo-user", key="persona")

    assert result.status == "reserved"
    assert result.toolType == "agent_memory"
    assert result.error.code == RESERVED_FEATURE
    assert result.error.details["key"] == "persona"
