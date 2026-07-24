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
            "topicOpportunities": [
                {"title": "大学生如何重启自律。", "angle": "从失败后怎么重新开始切入。"},
                {"title": "考证时间怎么安排。", "angle": "用一张表拆出每天任务。"},
                {"title": "低成本自律清单。", "angle": "从宿舍能做的小事开始。"},
            ],
        }
    )

    assert text == (
        "**趋势维度：**近一周 / 小红书 / 大学生成长。\n"
        "**趋势总结：**时间管理内容在升温。\n"
        "**当前热点包括：**低成本自律：用户更关注能马上照做的方法。\n"
        "**受众需求：**考证规划：很多人会问具体怎么安排时间。\n"
        "**推荐选题：**\n"
        "1. 大学生如何重启自律，角度：从失败后怎么重新开始切入\n"
        "2. 考证时间怎么安排，角度：用一张表拆出每天任务\n"
        "3. 低成本自律清单，角度：从宿舍能做的小事开始"
    )


def test_format_trend_text_maps_internal_period_and_platform_values() -> None:
    service = TrendService()

    text = service._format_trend_text(
        {
            "trendSummary": {
                "period": "7d",
                "platform": "xiaohongshu",
                "niche": "涨粉赛道",
                "summary": "新手经验分享内容更容易被收藏。",
            },
        }
    )

    assert "7d" not in text
    assert "xiaohongshu" not in text
    assert "**趋势维度：**近七天 / 小红书 / 涨粉赛道。" in text


def test_format_trend_text_prefers_structured_report_over_short_reply() -> None:
    service = TrendService()

    text = service._format_trend_text(
        {
            "reply": "已生成完整热门追踪。",
            "trendSummary": {"niche": "涨粉赛道", "summary": "新手经验分享内容更容易被收藏。"},
            "hotTrends": [{"name": "种草方法", "reason": "用户想看真实使用过程"}],
            "audienceNeeds": [{"need": "快速判断值不值得买", "evidence": "评论区常问避雷点"}],
            "topicOpportunities": [{"title": "新手种草别只夸好用", "angle": "从真实踩坑切入"}],
        }
    )

    assert "**趋势总结：**新手经验分享内容更容易被收藏。" in text
    assert "**当前热点包括：**种草方法：用户想看真实使用过程。" in text
    assert text != "已生成完整热门追踪。"


def test_sanitize_trend_copy_keeps_topics_in_graphic_text_scope() -> None:
    service = TrendService()

    text = service._format_trend_text(
        {
            "trendSummary": {"niche": "涨粉赛道", "summary": "适合做图文笔记。"},
            "hotTrends": [{"name": "短视频脚本拆解", "reason": "用户想看口播脚本和视频分镜"}],
            "audienceNeeds": [{"need": "拍摄成本低", "evidence": "希望不用复杂镜头"}],
            "topicOpportunities": [{"title": "短视频脚本复盘", "angle": "用三段视频讲清楚"}],
        }
    )

    assert "视频脚本" not in text
    assert "短视频" not in text
    assert "口播脚本" not in text
    assert "分镜" not in text
    assert "镜头" not in text
    assert "图文笔记" in text


def test_build_complete_analysis_uses_relevant_track_name() -> None:
    service = TrendService()

    payload = service._build_complete_analysis(
        {
            "originalUserPreference": "恋与深空沈星回卡面测评",
            "trendSummary": {"niche": "智能趋势分析", "summary": "卡面测评和抽卡体验讨论升温。"},
            "hotTrends": [{"name": "沈星回卡面细节", "reason": "玩家关注卡面氛围和剧情关联"}],
            "audienceNeeds": [{"need": "想知道值不值得抽", "evidence": "评论常问抽卡建议"}],
            "topicOpportunities": [{"title": "沈星回新卡到底值不值得抽", "angle": "从卡面细节和剧情体验切入"}],
        }
    )

    assert payload is not None
    assert payload["trackName"] != "智能趋势分析"
    assert "恋与深空" in payload["trackName"] or "沈星回" in payload["trackName"]


def test_build_complete_analysis_keeps_evidence_summary() -> None:
    service = TrendService()

    payload = service._build_complete_analysis(
        {
            "originalUserPreference": "大学生成长",
            "trendSummary": {"niche": "大学生成长", "summary": "低成本成长内容值得验证。"},
            "hotTrends": [{"name": "低成本成长", "reason": "公开网页有相关讨论"}],
            "audienceNeeds": [{"need": "马上照做", "evidence": "用户偏好清单型内容"}],
            "topicOpportunities": [{"title": "低成本自律清单", "angle": "从宿舍可做的小事切入"}],
            "evidenceSummary": {
                "tier": "public_web",
                "label": "公开网页佐证",
                "sourceType": "web_search",
                "sourceCount": 2,
                "validationKeywords": ["低成本成长"],
                "limitations": "不代表官方热度排名。",
            },
        }
    )

    assert payload is not None
    assert payload["evidenceSummary"]["label"] == "公开网页佐证"


def test_build_complete_analysis_uses_useful_conservative_fallback_when_evidence_is_missing() -> None:
    service = TrendService()

    payload = service._build_complete_analysis(
        {
            "originalUserPreference": "瑶妹开黑日常",
            "trendSummary": {"period": "7d", "platform": "xiaohongshu", "niche": "经验分享", "summary": ""},
            "hotTrends": [],
            "audienceNeeds": [],
            "topicOpportunities": [
                {"title": "瑶妹开黑日常新手先看这篇"},
                {"title": "瑶妹开黑日常真实避坑清单"},
                {"title": "瑶妹开黑日常怎么开始更稳"},
            ],
            "evidenceSummary": {
                "tier": "inferred",
                "label": "需要验证",
                "sourceType": "none",
                "sourceCount": 0,
                "validationKeywords": [],
                "limitations": "本轮未拿到可用检索结果，已降级为保守判断。",
            },
        }
    )

    assert payload is not None
    assert "暂无" not in payload["trends"]
    assert "暂无" not in payload["audience"]
    assert "瑶妹开黑日常" in payload["trends"]
    assert "需要验证" in payload["trends"]
    assert "新手" in payload["audience"]
