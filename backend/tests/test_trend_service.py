from backend.app.services.trend.service import TrendService
from backend.app.schemas.agent.protocol import AgentRunResponse


def test_should_force_structured_report_requires_clear_generation_intent() -> None:
    service = TrendService()

    assert service._should_force_structured_report("给我做一版大学生成长赛道的热点选题", [])
    assert service._should_force_structured_report("大学生成长赛道最近一周有什么适合做的热点选题", [])
    assert service._should_force_structured_report("继续分析这个方向还能怎么做", [{"role": "user", "content": "上轮结果"}])
    assert service._should_force_structured_report("我昨天刷到一个宠物洗护吐槽贴", [{"role": "user", "content": "我昨天刷到一个宠物洗护吐槽贴"}])

    assert service._should_force_structured_report("为什么你刚才优先推荐第一个", [{"role": "assistant", "content": "上轮结果"}]) is False
    assert service._should_force_structured_report("好的继续", [{"role": "assistant", "content": "上轮结果"}]) is False
    assert service._should_force_structured_report(
        "请总结当前进度",
        [{"role": "assistant", "content": "上轮结果"}],
        summary_mode="realtime_progress",
    )


def test_normalize_history_record_card_preview_to_short_phrases() -> None:
    service = TrendService()

    normalized = service._normalize_history_record(
        {
            "trackName": "大学生成长赛道",
            "trackTime": "2026/05/22",
            "userPrompt": "大学生成长赛道最近热点",
            "trends": "低成本成长、考证避坑持续升温，用户更愿意收藏可执行、少踩坑的内容。",
            "audience": "用户更想要低门槛、可立即执行的方法。",
            "topics": [
                "大学生第一次考证最容易踩的 5 个坑",
                "低成本提升自己的 7 件小事",
            ],
            "cardPreview": {
                "discoveryKeywords": [
                    "低成本成长、考证避坑持续升温，用户更愿意收藏可执行、少踩坑的内容。"
                ],
                "shortTopics": [
                    "大学生第一次考证最容易踩的 5 个坑"
                ],
            },
        }
    )

    assert normalized["cardPreview"]["discoveryKeywords"] == ["考证避坑", "低成本成长", "可执行方法"]
    assert normalized["cardPreview"]["shortTopics"] == ["考证避坑", "低成本成长"]


def test_get_trend_history_normalizes_saved_card_preview(monkeypatch) -> None:
    service = TrendService()
    raw_history = [
        {
            "trackName": "大学生成长赛道",
            "trackTime": "2026/05/22",
            "userPrompt": "大学生成长赛道最近热点",
            "trends": "低成本成长、考证避坑持续升温，用户更愿意收藏可执行、少踩坑的内容。",
            "audience": "用户更想要低门槛、可立即执行的方法。",
            "topics": ["大学生第一次考证最容易踩的 5 个坑"],
            "cardPreview": {
                "discoveryKeywords": [
                    "低成本成长、考证避坑持续升温，用户更愿意收藏可执行、少踩坑的内容。"
                ],
                "shortTopics": [
                    "大学生第一次考证最容易踩的 5 个坑"
                ],
            },
        }
    ]

    monkeypatch.setattr(service.trend_crud, "get_trend_history", lambda user_id: raw_history)

    history = __import__("asyncio").run(service.get_trend_history("user-1"))

    assert history[0]["cardPreview"]["discoveryKeywords"] == ["考证避坑", "低成本成长", "可执行方法"]
    assert history[0]["cardPreview"]["shortTopics"] == ["考证避坑", "低成本成长", "可执行方法"]


def test_track_forces_structured_report_on_initial_page_first_turn(monkeypatch) -> None:
    service = TrendService()
    captured = {}

    async def fake_has_saved_persona(user_id: str) -> bool:
        return True

    async def fake_build_context(
        user_id: str,
        persona: dict | None,
        conversation_history: list | None,
        summary_source_conversation: list | None,
    ) -> dict:
        return {"savedPersona": {"persona": {"name": "大学生成长型学习博主"}}}

    async def fake_run(request) -> AgentRunResponse:
        captured["options"] = request.options
        captured["input"] = request.input
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "reply": "已生成完整热门追踪。",
                "isReadyToSave": True,
                "trendSummary": {"niche": "大学生成长", "summary": "低成本成长和考证避坑热度上升"},
                "hotTrends": [{"name": "低成本成长", "reason": "更容易被收藏", "heatLevel": "high"}],
                "audienceNeeds": [{"need": "快速上手", "evidence": "更偏好可直接执行的方法", "confidence": "medium"}],
                "topicOpportunities": [{"title": "大学生第一次考证最容易踩的 5 个坑"}],
                "cardPreview": {"discoveryKeywords": ["低成本成长"], "shortTopics": ["考证避坑"]},
            },
            warnings=[],
        )

    monkeypatch.setattr(service, "_has_saved_persona", fake_has_saved_persona)
    monkeypatch.setattr(service.builder, "build_trend_track_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.track(
            "user-1",
            "我昨天刷到一个宠物洗护吐槽贴",
            persona=None,
            conversation_history=[{"role": "user", "content": "我昨天刷到一个宠物洗护吐槽贴"}],
        )
    )

    assert captured["options"]["forceStructuredReport"] is True
    assert captured["input"]["originalUserPreference"] == "我昨天刷到一个宠物洗护吐槽贴"
    assert "这是热门追踪初始页的首条业务输入" in captured["input"]["userPreference"]
    assert "用户原始输入：我昨天刷到一个宠物洗护吐槽贴" in captured["input"]["userPreference"]
    assert result["data"]["discussionOnly"] is False


def test_track_builds_realtime_progress_summary_prompt(monkeypatch) -> None:
    service = TrendService()
    captured = {}

    async def fake_has_saved_persona(user_id: str) -> bool:
        return True

    async def fake_build_context(
        user_id: str,
        persona: dict | None,
        conversation_history: list | None,
        summary_source_conversation: list | None,
    ) -> dict:
        return {"savedPersona": {"persona": {"name": "大学生成长型学习博主"}}}

    async def fake_run(request) -> AgentRunResponse:
        captured["options"] = request.options
        captured["input"] = request.input
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "reply": "已更新实时进度。",
                "isReadyToSave": True,
                "trendSummary": {"niche": "大学生成长", "summary": "低成本成长和考证避坑热度上升"},
                "hotTrends": [{"name": "低成本成长", "reason": "更容易被收藏", "heatLevel": "high"}],
                "audienceNeeds": [{"need": "快速上手", "evidence": "更偏好可直接执行的方法", "confidence": "medium"}],
                "topicOpportunities": [{"title": "大学生第一次考证最容易踩的 5 个坑"}],
                "cardPreview": {"discoveryKeywords": ["低成本成长"], "shortTopics": ["考证避坑"]},
            },
            warnings=[],
        )

    monkeypatch.setattr(service, "_has_saved_persona", fake_has_saved_persona)
    monkeypatch.setattr(service.builder, "build_trend_track_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.track(
            "user-1",
            "请总结当前进度",
            persona=None,
            conversation_history=[
                {"role": "user", "content": "最近还想补充低成本自律"},
                {"role": "assistant", "content": "我再帮你补一轮"},
            ],
            summary_source_conversation=[
                {"role": "user", "content": "我想做大学生成长"},
                {"role": "assistant", "content": "先给你一版趋势分析"},
            ],
            summary_mode="realtime_progress",
        )
    )

    assert captured["options"]["forceStructuredReport"] is True
    assert "这是热门追踪里的“总结实时进度”专属请求。" in captured["input"]["userPreference"]
    assert "用户：我想做大学生成长" in captured["input"]["userPreference"]
    assert "助手：先给你一版趋势分析" in captured["input"]["userPreference"]
    assert "最近还想补充低成本自律" not in captured["input"]["userPreference"]
    assert result["data"]["discussionOnly"] is False


def test_format_trend_text_normalizes_joined_punctuation() -> None:
    service = TrendService()

    text = service._format_trend_text(
        {
            "trendSummary": {
                "period": "近一周。",
                "platform": "小红书 /",
                "niche": "大学生成长。",
                "summary": "时间管理内容在升温。",
            },
            "hotTrends": [{"name": "低成本自律。", "reason": "用户更关注能马上照做的方法。"}],
            "audienceNeeds": [{"need": "考证规划：", "evidence": "很多人会问具体怎么安排时间。"}],
            "topicOpportunities": [{"title": "大学生如何重启自律。", "angle": "从失败后怎么重新开始切入。"}],
        }
    )

    assert text == (
        "趋势维度：近一周 / 小红书 / 大学生成长。\n"
        "趋势总结：时间管理内容在升温。\n"
        "当前热点包括：低成本自律：用户更关注能马上照做的方法。\n"
        "受众需求：考证规划：很多人会问具体怎么安排时间。\n"
        "推荐选题：1. 大学生如何重启自律，角度：从失败后怎么重新开始切入。"
    )
