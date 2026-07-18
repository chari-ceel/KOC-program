import asyncio

from backend.app.schemas.agent.protocol import AgentRunResponse
from backend.app.services.persona.service import PersonaService


class _FakeClient:
    def __init__(self, response: AgentRunResponse) -> None:
        self.response = response

    async def run(self, request):  # pragma: no cover - request shape is irrelevant here
        return self.response


class _FakeBuilder:
    async def build_persona_analyze_context(self, user_id: str):
        return {}

    async def build_persona_follow_up_context(self, user_id: str, basic_info: dict, conversation_history: list):
        return {}


def _build_service(response: AgentRunResponse) -> PersonaService:
    service = PersonaService()
    service.client = _FakeClient(response)
    service.builder = _FakeBuilder()
    return service


def test_analyze_normalizes_persona_name_and_save_payload() -> None:
    response = AgentRunResponse(
        requestId="req-persona",
        taskType="persona.analyze",
        platform="xiaohongshu",
        status="success",
        data={
            "persona": {
                "name": "我是顶流大学生成长学习规划博主，主打真实分享。",
                "description": "desc",
            },
            "niche": {"primary": "大学生成长"},
        },
        savePayload={
            "type": "persona_result",
            "suggestedCollection": "persona_results",
            "data": {
                "persona": {
                    "name": "建议你做顶流大学生成长学习规划博主：更容易涨粉",
                }
            },
        },
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.analyze("user-1", {"occupation": "大学生"}, persist=False))

    assert result["data"]["persona"]["name"] == "大学生成长学习规划博主"
    assert response.savePayload["data"]["persona"]["name"] == "大学生成长学习规划博主"
    assert result["data"]["discussionOnly"] is False
    assert result["data"]["structuredResult"]["persona"]["name"] == "大学生成长学习规划博主"


def test_analyze_forces_initial_structured_persona(monkeypatch) -> None:
    service = PersonaService()
    captured = {}

    async def fake_build_context(user_id: str) -> dict:
        return {}

    async def fake_run(request) -> AgentRunResponse:
        captured["options"] = request.options
        captured["input"] = request.input
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "persona": {"name": "绘画游戏探索者"},
                "niche": {"primary": "兴趣成长"},
                "audience": ["大学生"],
                "contentStyle": ["真实"],
                "referenceCreatorDirections": ["兴趣分享"],
                "followUpQuestions": ["你更想先做绘画还是游戏？"],
            },
            savePayload={},
            warnings=[],
            error={},
            metadata={},
        )

    monkeypatch.setattr(service.builder, "build_persona_analyze_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = asyncio.run(
        service.analyze(
            "user-1",
            {
                "occupation": "大学生",
                "interests": ["绘画", "游戏"],
                "skills": ["拍照"],
            },
            persist=False,
        )
    )

    assert captured["options"]["forceStructuredPersona"] is True
    assert captured["options"]["enableTools"] is False
    assert "这是人设打造初始页的首条业务输入。" in captured["input"]["baseInfo"]["goals"][0]
    assert captured["input"]["originalBaseInfo"]["occupation"] == "大学生"
    assert result["data"]["discussionOnly"] is False


def test_analyze_limits_optional_follow_up_questions() -> None:
    response = AgentRunResponse(
        requestId="req-persona-questions",
        taskType="persona.analyze",
        platform="xiaohongshu",
        status="success",
        data={
            "persona": {"name": "校园穿搭记录者"},
            "niche": {"primary": "校园穿搭"},
            "followUpQuestions": [
                "你平时最喜欢看哪类穿搭笔记？",
                "有什么完全不想尝试的风格？",
                "你日常最方便拍哪些场景？",
                "你更喜欢聊天感还是教程感？",
                "你想吸引哪类粉丝？",
            ],
        },
        savePayload={
            "type": "persona_result",
            "suggestedCollection": "persona_results",
            "data": {
                "persona": {"name": "校园穿搭记录者"},
                "followUpQuestions": [
                    "你平时最喜欢看哪类穿搭笔记？",
                    "有什么完全不想尝试的风格？",
                    "你日常最方便拍哪些场景？",
                    "你更喜欢聊天感还是教程感？",
                ],
            },
        },
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.analyze("user-1", {"occupation": "大学生"}, persist=False))

    assert result["data"]["followUpQuestions"] == [
        "你平时最喜欢看哪类穿搭笔记？",
        "有什么完全不想尝试的风格？",
        "你日常最方便拍哪些场景？",
    ]
    assert response.savePayload["data"]["followUpQuestions"] == [
        "你平时最喜欢看哪类穿搭笔记？",
        "有什么完全不想尝试的风格？",
        "你日常最方便拍哪些场景？",
    ]


def test_follow_up_and_manual_save_normalize_persona_draft_name() -> None:
    response = AgentRunResponse(
        requestId="req-follow-up",
        taskType="persona.follow_up",
        platform="xiaohongshu",
        status="success",
        data={
            "reply": "ok",
            "personaDraft": {
                "persona": {
                    "name": "适合做高端低成本效率提升经验分享账号，因为更容易理解",
                }
            },
        },
        savePayload={},
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.follow_up("user-1", {"occupation": "大学生"}, "继续", []))
    assert result["data"]["personaDraft"]["persona"]["name"] == "低成本效率提升经验"

    saved = service.save_persona(
        "user-1",
        {
            "persona": {
                "name": "我是全能大学生成长学习规划博主，想帮助同龄人",
            }
        },
    )
    assert saved["data"]["persona"]["name"] == "大学生成长学习规划博主"


def test_follow_up_with_more_info_prompt_stays_discussion_only() -> None:
    response = AgentRunResponse(
        requestId="req-follow-up-discussion",
        taskType="persona.follow_up",
        platform="xiaohongshu",
        status="success",
        data={
            "reply": "为了更好地帮你细化这个方向，我还需要了解几个具体信息。",
            "nextQuestions": ["你更想强调教学、创作过程，还是作品表达？"],
            "personaDraft": {
                "persona": {
                    "name": "专业绘画成长记录者",
                },
                "niche": {"primary": "绘画成长"},
            },
        },
        savePayload={},
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.follow_up("user-1", {"occupation": "大学生"}, "我想突出绘画专业性", []))

    assert result["data"]["discussionOnly"] is True
    assert result["data"]["structuredResult"] is None
    assert result["data"]["personaDraft"]["persona"]["name"] == "专业绘画成长记录者"


def test_follow_up_complete_persona_draft_with_next_questions_stays_discussion_only() -> None:
    response = AgentRunResponse(
        requestId="req-follow-up-complete-with-questions",
        taskType="persona.follow_up",
        platform="xiaohongshu",
        status="success",
        data={
            "reply": "我先把当前方向整理成一版完整人设。为了后续更精准，也可以继续确认几个问题。",
            "nextQuestions": ["你更想偏绘画教学，还是偏创作过程记录？"],
            "isReadyToSave": False,
            "personaDraft": {
                "persona": {
                    "name": "水彩游戏少女",
                    "description": "围绕水彩创作、游戏灵感和大学生日常持续分享艺术生活内容。",
                },
                "niche": {
                    "primary": "水彩游戏创作",
                    "secondary": ["创作过程", "艺术生活"],
                },
                "audience": ["喜欢水彩艺术的年轻人", "关注游戏美术的玩家"],
                "contentStyle": ["清新", "真实", "有趣"],
            },
        },
        savePayload={},
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.follow_up("user-1", {"occupation": "大学生"}, "我还喜欢游戏和水彩", []))

    assert result["data"]["discussionOnly"] is True
    assert result["data"]["structuredResult"] is None
    assert result["data"]["personaDraft"]["persona"]["name"] == "水彩游戏少女"
    assert result["data"]["nextQuestions"] == ["你更想偏绘画教学，还是偏创作过程记录？"]


def test_follow_up_explicit_final_persona_intent_is_structured() -> None:
    response = AgentRunResponse(
        requestId="req-follow-up-explicit-final",
        taskType="persona.follow_up",
        platform="xiaohongshu",
        status="success",
        data={
            "reply": "好的，我按这个方向整理成一版完整人设。",
            "nextQuestions": ["后续可以继续微调内容栏目。"],
            "isReadyToSave": False,
            "personaDraft": {
                "persona": {
                    "name": "水彩游戏少女",
                    "description": "围绕水彩创作、游戏灵感和大学生日常持续分享艺术生活内容。",
                },
                "niche": {
                    "primary": "水彩游戏创作",
                    "secondary": ["创作过程", "艺术生活"],
                },
                "audience": ["喜欢水彩艺术的年轻人", "关注游戏美术的玩家"],
                "contentStyle": ["清新", "真实", "有趣"],
            },
        },
        savePayload={},
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(service.follow_up("user-1", {"occupation": "大学生"}, "就按这个来，输出完整人设", []))

    assert result["data"]["discussionOnly"] is False
    assert result["data"]["structuredResult"]["persona"]["name"] == "水彩游戏少女"


def test_card_preview_is_strongly_compressed_without_shortening_visible_text() -> None:
    long_description = (
        "通过绘画、弹吉他、唱歌记录和分享充满艺术气息的日常生活与成长点滴，"
        "用画笔描绘世界，用琴弦和歌声表达情感，传递对生活和艺术的热爱。"
    )
    response = AgentRunResponse(
        requestId="req-persona-card-preview",
        taskType="persona.analyze",
        platform="xiaohongshu",
        status="success",
        data={
            "persona": {
                "name": "艺术生活记录者",
                "description": long_description,
            },
            "niche": {"primary": "艺术生活", "secondary": ["绘画", "音乐"]},
            "audience": ["大学生", "艺术兴趣新手"],
            "contentStyle": ["清新", "真实", "有生活感"],
            "cardPreview": {
                "personaLabel": "人设定位：艺术生活记录者，一位20岁的女大学生",
                "baseProfile": "女·20·大学生",
                "keywordsLabel": "绘画、弹吉他、唱歌",
                "audienceLabel": "对绘画和音乐感兴趣的年轻人",
                "toneLabel": "清新、真实、有生活感",
            },
        },
        savePayload={},
        warnings=[],
        error={},
        metadata={},
    )
    service = _build_service(response)

    result = asyncio.run(
        service.analyze(
            "user-1",
            {
                "gender": "女",
                "age": "20",
                "occupation": "大学生",
                "interests": ["绘画", "弹吉他", "唱歌"],
            },
            persist=False,
        )
    )

    card_preview = result["data"]["cardPreview"]
    assert result["data"]["persona"]["description"] == long_description
    assert len(card_preview["keywordsLabel"]) <= 16
    assert len(card_preview["audienceLabel"]) <= 14
    assert len(card_preview["baseProfile"]) <= 16
    assert all(len(value) <= 14 for key, value in card_preview.items() if key not in {"keywordsLabel", "audienceLabel", "baseProfile"})
    assert card_preview["personaLabel"] == "艺术生活"
    assert card_preview["keywordsLabel"] == "绘画 · 弹吉他 · 唱歌"
    assert card_preview["audienceLabel"] == "年轻人"


def test_format_persona_text_normalizes_joined_punctuation() -> None:
    service = PersonaService()

    text = service._format_persona_text(
        {
            "persona": {
                "name": "成长型学习博主。",
                "description": "持续分享低成本成长方法。",
            },
            "niche": {"primary": "大学生成长。", "secondary": ["时间管理，", "考证规划。"]},
            "audience": ["大学生。", "考证党。"],
            "contentStyle": ["真实陪伴。", "低门槛实用。"],
            "followUpQuestions": ["你更想先解决自律还是考证。"],
        }
    )

    assert text == (
        "推荐人设：成长型学习博主。"
        "人设描述：持续分享低成本成长方法。"
        "擅长领域：大学生成长、时间管理、考证规划。"
        "目标受众：大学生、考证党。"
        "内容风格：真实陪伴、低门槛实用。"
        "后续可继续回答的问题：你更想先解决自律还是考证。"
    )
