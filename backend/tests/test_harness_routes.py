import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.endpoints.web import content as content_endpoint
from backend.app.endpoints.web import persona as persona_endpoint
from backend.app.endpoints.web import trends as trends_endpoint
from backend.app.endpoints.web import chat as chat_endpoint
from backend.app.services.auth import AuthenticatedUser, get_current_user, require_current_user


client = TestClient(app)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _read_json(filename: str) -> dict:
    return json.loads((FIXTURES_DIR / filename).read_text(encoding="utf-8"))


def _test_user() -> AuthenticatedUser:
    return AuthenticatedUser(user_id="session-user", username="tester")


def setup_function() -> None:
    app.dependency_overrides[require_current_user] = _test_user
    app.dependency_overrides[get_current_user] = _test_user


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_debug_prompts_returns_human_voice_skill() -> None:
    response = client.get("/api/debug/prompts")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["prompts"]["content"]["appliedSkills"] == ["human_voice"]
    assert "human_voice" in data["skills"]
    assert "Human Voice Skill" in data["skills"]["human_voice"]["content"]


def test_persona_analyze_route_returns_agent_data(monkeypatch) -> None:
    request_body = _read_json("persona_test.json")
    captured = {}

    async def fake_analyze(user_id: str, basic_info: dict) -> dict:
        captured["user_id"] = user_id
        captured["basic_info"] = basic_info
        return {
            "data": {
                "persona": {"name": "大学生成长型学习博主"},
                "niche": {"primary": "大学生成长"},
                "followUpQuestions": ["你最常被同学问什么问题？"],
            },
            "warnings": [],
        }

    monkeypatch.setattr(persona_endpoint.service, "analyze", fake_analyze)

    response = client.post("/api/persona/analyze", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["warnings"] == []
    assert payload["data"]["persona"]["name"] == "大学生成长型学习博主"
    assert payload["data"]["niche"]["primary"] == "大学生成长"
    assert captured == {
        "user_id": "session-user",
        "basic_info": request_body["basicInfo"],
    }


def test_persona_follow_up_route_returns_discussion_only_wrapper(monkeypatch) -> None:
    captured = {}

    async def fake_follow_up(user_id: str, basic_info: dict, user_message: str, conversation_history=None, prompt_override=None) -> dict:
        captured["user_id"] = user_id
        captured["user_message"] = user_message
        return {
            "data": {
                "reply": "为了更好地细化方向，我还需要了解几个具体信息。",
                "nextQuestions": ["你更想强调教学、创作过程，还是作品表达？"],
                "discussionOnly": True,
                "structuredResult": None,
                "personaDraft": {
                    "persona": {"name": "专业绘画成长记录者"},
                },
            },
            "warnings": [],
        }

    monkeypatch.setattr(persona_endpoint.service, "follow_up", fake_follow_up)

    response = client.post(
        "/api/persona/follow_up",
        json={
            "basicInfo": {"occupation": "大学生"},
            "userMessage": "我想突出我在绘画上的专业性",
            "conversationHistory": [],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["data"]["discussionOnly"] is True
    assert payload["data"]["structuredResult"] is None
    assert payload["data"]["personaDraft"]["persona"]["name"] == "专业绘画成长记录者"
    assert captured["user_id"] == "session-user"


def test_trend_track_route_returns_discussion_only_wrapper(monkeypatch) -> None:
    request_body = _read_json("trend_followup_test.json")

    async def fake_track(
        user_id: str,
        preference: str,
        persona=None,
        conversation_history=None,
        summary_source_conversation=None,
        summary_mode=None,
        prompt_override=None,
    ) -> dict:
        return {
            "data": {
                "discussionOnly": True,
                "completeAnalysis": None,
                "text": "先别急着出完整报告，我先解释为什么优先做第一个。",
                "raw": {
                    "reply": "先别急着出完整报告，我先解释为什么优先做第一个。",
                    "isReadyToSave": False,
                },
            },
            "warnings": [],
        }

    monkeypatch.setattr(trends_endpoint.service, "track", fake_track)

    response = client.post("/api/trends/track", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["data"]["discussionOnly"] is True
    assert payload["data"]["completeAnalysis"] is None
    assert "解释为什么优先做第一个" in payload["data"]["text"]


def test_trend_track_route_returns_complete_analysis_wrapper(monkeypatch) -> None:
    request_body = _read_json("trend_test.json")

    async def fake_track(
        user_id: str,
        preference: str,
        persona=None,
        conversation_history=None,
        summary_source_conversation=None,
        summary_mode=None,
        prompt_override=None,
    ) -> dict:
        return {
            "data": {
                "discussionOnly": False,
                "completeAnalysis": {
                    "trackName": "大学生成长",
                    "trends": "低成本成长、考证避坑持续升温",
                    "audience": "用户更想要低门槛、可立即执行的方法",
                    "topics": [
                        "大学生第一次考证最容易踩的 5 个坑",
                        "低成本提升自己的 7 件小事",
                    ],
                    "cardPreview": {
                        "discoveryKeywords": ["低成本成长", "考证避坑"],
                        "shortTopics": ["考证避坑", "低成本自律"],
                    },
                },
                "text": "最近大学生成长赛道里，可执行、少踩坑内容更容易被收藏。",
                "raw": {"reply": "最近大学生成长赛道里，可执行、少踩坑内容更容易被收藏。"},
            },
            "warnings": [],
        }

    monkeypatch.setattr(trends_endpoint.service, "track", fake_track)

    response = client.post("/api/trends/track", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["data"]["discussionOnly"] is False
    assert payload["data"]["completeAnalysis"]["trackName"] == "大学生成长"
    assert len(payload["data"]["completeAnalysis"]["topics"]) == 2
    assert payload["data"]["completeAnalysis"]["cardPreview"]["discoveryKeywords"] == ["低成本成长", "考证避坑"]


def test_content_draft_route_returns_complete_draft_wrapper(monkeypatch) -> None:
    request_body = _read_json("content_draft_verify.json")

    async def fake_draft(
        user_id: str,
        topic: str,
        instruction: str,
        conversation_history=None,
        current_draft=None,
        revision_instruction=None,
        writing_entry_source=None,
        persona=None,
        prompt_override=None,
    ) -> dict:
        return {
            "data": {
                "discussionOnly": False,
                "completeDraft": {
                    "title": "第一次考证，我最想提前知道的 5 件事",
                    "intro": "如果你也是第一次准备考证，先别急着买一堆资料。",
                    "body": ["先定考试时间", "再拆每周计划"],
                    "ending": "你第一次考证最担心哪一步？",
                    "tags": ["大学生成长", "考证规划"],
                    "cardPreview": {
                        "keywords": ["考证避坑", "新手规划"],
                    },
                },
                "draft": {
                    "selectedTitle": "第一次考证，我最想提前知道的 5 件事",
                    "hook": "如果你也是第一次准备考证，先别急着买一堆资料。",
                },
                "suggestions": [
                    {
                        "label": "把标题改得更像搜索词",
                        "instruction": "请把标题改得更像小红书搜索词。",
                        "intent": "title_optimize",
                    }
                ],
                "text": "推荐标题：第一次考证，我最想提前知道的 5 件事",
                "raw": {},
            },
            "warnings": [],
        }

    monkeypatch.setattr(content_endpoint.service, "draft", fake_draft)

    response = client.post("/api/content/draft", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["data"]["discussionOnly"] is False
    assert payload["data"]["completeDraft"]["title"] == "第一次考证，我最想提前知道的 5 件事"
    assert payload["data"]["completeDraft"]["cardPreview"]["keywords"] == ["考证避坑", "新手规划"]
    assert payload["data"]["suggestions"][0]["intent"] == "title_optimize"


def test_content_revise_route_returns_complete_draft_wrapper(monkeypatch) -> None:
    request_body = _read_json("content_revise_verify.json")

    async def fake_draft(
        user_id: str,
        topic: str,
        instruction: str,
        conversation_history=None,
        current_draft=None,
        revision_instruction=None,
        writing_entry_source=None,
        persona=None,
        prompt_override=None,
    ) -> dict:
        return {
            "data": {
                "discussionOnly": False,
                "completeDraft": {
                    "title": "大学这几年，我后知后觉才明白的 5 件事",
                    "intro": "如果重新读一次大学，我会更早开始做这几件小事。",
                    "body": ["先把目标拆小", "别把计划写得太满"],
                    "ending": "你上大学后最后悔没早点做的是哪件事？",
                    "tags": ["大学生活", "个人成长"],
                    "cardPreview": {
                        "keywords": ["目标拆解", "个人成长"],
                    },
                },
                "draft": {
                    "selectedTitle": "大学这几年，我后知后觉才明白的 5 件事",
                },
                "suggestions": [
                    {
                        "label": "结尾再自然一点",
                        "instruction": "请把结尾改得更像朋友聊天时的评论互动。",
                        "intent": "ending_optimize",
                    }
                ],
                "text": "标题和结尾已经按更生活化的方向改好了。",
                "raw": {},
            },
            "warnings": [],
        }

    monkeypatch.setattr(content_endpoint.service, "draft", fake_draft)

    response = client.post("/api/content/draft", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["data"]["discussionOnly"] is False
    assert payload["data"]["completeDraft"]["ending"] == "你上大学后最后悔没早点做的是哪件事？"
    assert payload["data"]["completeDraft"]["cardPreview"]["keywords"] == ["目标拆解", "个人成长"]
    assert payload["data"]["suggestions"][0]["intent"] == "ending_optimize"


def test_general_chat_route_uses_authenticated_user_persona(monkeypatch) -> None:
    captured = {}

    def fake_get_persona(user_id: str) -> dict:
        captured["persona_user_id"] = user_id
        return {"persona": {"name": "专业绘画成长记录者"}}

    async def fake_run(request) -> object:
        captured["request_user_id"] = request.userId
        captured["context"] = request.context
        return type(
            "FakeAgentResponse",
            (),
            {
                "status": "success",
                "data": {"reply": "我会按你已保存的专业绘画成长记录者方向来聊。"},
                "error": None,
            },
        )()

    monkeypatch.setattr(chat_endpoint.persona_crud, "get_persona", fake_get_persona)
    monkeypatch.setattr(chat_endpoint.client, "run", fake_run)

    response = client.post(
        "/api/chat",
        json={
            "message": "我这个方向怎么继续做？",
            "userId": "demo-user",
            "conversationHistory": [{"role": "user", "content": "我这个方向怎么继续做？"}],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "我会按你已保存的专业绘画成长记录者方向来聊。"
    assert captured["persona_user_id"] == "session-user"
    assert captured["request_user_id"] == "session-user"
    assert captured["context"]["savedPersona"]["persona"]["name"] == "专业绘画成长记录者"


def test_trend_track_route_forwards_agent_debug_and_returns_debug_payload(monkeypatch) -> None:
    request_body = _read_json("trend_test.json")
    request_body["agentDebug"] = {
        "enableTools": True,
        "requireRealWebResearch": True,
        "exposeAgentDetails": True,
        "maxToolCalls": 5,
        "contentType": "image_text_note",
        "language": "zh-CN",
        "debugAuth": {
            "webSearchApiKey": "tvly-test",
            "webSearchProvider": "tavily",
        },
    }
    captured = {}

    async def fake_track(
        user_id: str,
        preference: str,
        persona=None,
        conversation_history=None,
        summary_source_conversation=None,
        summary_mode=None,
        prompt_override=None,
        agent_debug=None,
    ) -> dict:
        captured["user_id"] = user_id
        captured["preference"] = preference
        captured["agent_debug"] = agent_debug
        return {
            "data": {
                "discussionOnly": True,
                "completeAnalysis": None,
                "text": "已进入真实检索调试。",
                "raw": {"reply": "已进入真实检索调试。"},
            },
            "warnings": [],
            "debug": {
                "agentStatus": "partial_success",
                "requestedOptions": {
                    "enableTools": True,
                    "requireRealWebResearch": True,
                    "maxToolCalls": 5,
                    "contentType": "image_text_note",
                    "language": "zh-CN",
                    "webSearchProvider": "tavily",
                },
                "sources": [{"sourceType": "web_search", "url": "https://example.com"}],
                "toolCalls": [{"toolName": "web_search"}],
                "metadata": {"retrievalSource": "web_search"},
                "error": {},
            },
        }

    monkeypatch.setattr(trends_endpoint.service, "track", fake_track)

    response = client.post("/api/trends/track", json=request_body)

    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == 200
    assert payload["debug"]["requestedOptions"]["enableTools"] is True
    assert payload["debug"]["requestedOptions"]["webSearchProvider"] == "tavily"
    assert payload["debug"]["sources"][0]["sourceType"] == "web_search"
    assert captured["user_id"] == "session-user"
    assert captured["agent_debug"]["debugAuth"]["webSearchApiKey"] == "tvly-test"
    assert captured["agent_debug"]["requireRealWebResearch"] is True


def test_trend_track_route_forwards_summary_source_conversation(monkeypatch) -> None:
    request_body = _read_json("trend_followup_test.json")
    request_body["summaryMode"] = "realtime_progress"
    request_body["summarySourceConversation"] = [
        {"role": "user", "content": "我想做大学生成长"},
        {"role": "assistant", "content": "先给你一版趋势分析"},
    ]
    captured = {}

    async def fake_track(
        user_id: str,
        preference: str,
        persona=None,
        conversation_history=None,
        summary_source_conversation=None,
        summary_mode=None,
        prompt_override=None,
    ) -> dict:
        captured["conversation_history"] = conversation_history
        captured["summary_source_conversation"] = summary_source_conversation
        captured["summary_mode"] = summary_mode
        return {
            "data": {
                "discussionOnly": False,
                "completeAnalysis": {
                    "trackName": "大学生成长",
                    "trends": "低成本成长",
                    "audience": "想要可执行方法",
                    "topics": ["大学生如何重启自律"],
                },
                "text": "已总结当前进度。",
                "raw": {"reply": "已总结当前进度。"},
            },
            "warnings": [],
        }

    monkeypatch.setattr(trends_endpoint.service, "track", fake_track)

    response = client.post("/api/trends/track", json=request_body)

    assert response.status_code == 200
    assert captured["summary_mode"] == "realtime_progress"
    assert captured["conversation_history"] == request_body["conversationHistory"]
    assert captured["summary_source_conversation"] == request_body["summarySourceConversation"]
