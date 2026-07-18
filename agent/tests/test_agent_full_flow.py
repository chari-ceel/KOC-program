from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _run_agent(task_type: str, request_id: str, input_data: dict, context: dict) -> dict:
    response = client.post(
        "/agent/run",
        json={
            "requestId": request_id,
            "taskType": task_type,
            "platform": "xiaohongshu",
            "userId": "demo-user",
            "input": input_data,
            "context": context,
            "options": {
                "language": "zh-CN",
                "mode": "test",
                "contentType": "image_text_note",
                "enableTools": True,
                "maxToolCalls": 3,
            },
        },
    )
    assert response.status_code == 200
    return response.json()


def test_full_agent_flow_persona_to_content_revision() -> None:
    persona = _run_agent(
        "persona.analyze",
        "e2e_persona_001",
        {
            "baseInfo": {
                "age": 21,
                "occupation": "大学生",
                "interests": ["学习", "穿搭", "拍照"],
                "skills": ["做计划", "整理资料"],
                "goals": ["涨粉", "记录成长"],
            }
        },
        {},
    )

    assert persona["status"] == "failed"
    assert persona["error"]["code"] == "MODEL_PROVIDER_UNAVAILABLE"


def test_full_flow_stops_when_required_persona_context_is_missing() -> None:
    trend = _run_agent(
        "trend.track",
        "e2e_missing_persona_001",
        {
            "userPreference": "我想找更容易涨粉的选题",
            "period": "7d",
        },
        {
            "trendHistory": [],
        },
    )

    assert trend["status"] == "failed"
    assert trend["error"]["code"] == "MISSING_CONTEXT"
    assert trend["error"]["details"]["missing"] == ["context.savedPersona"]
    assert trend["toolCalls"] == []
