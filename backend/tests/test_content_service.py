from backend.app.schemas.agent.protocol import AgentRunResponse
from backend.app.services.content.service import ContentService


def test_content_initial_page_first_turn_forces_full_draft(monkeypatch) -> None:
    service = ContentService()
    captured = {}

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "大学生成长型学习博主"}},
            "selectedTopic": selected_topic,
        }

    async def fake_run(request) -> AgentRunResponse:
        captured["options"] = request.options
        captured["input"] = request.input
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "reply": "已生成完整草稿。",
                "isReadyToSave": True,
                "draft": {
                    "selectedTitle": "大学生第一次考证前，我最想知道的 5 件事",
                    "intro": "如果你也是第一次准备考证，先别急着买一堆资料。",
                    "body": ["先定考试时间", "再拆每周计划"],
                    "ending": "你第一次考证最担心哪一步？",
                    "tags": ["大学生成长", "考证规划"],
                    "cardPreview": {"keywords": ["考证避坑", "新手规划"]},
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "大学",
            "大学",
            conversation_history=[{"role": "user", "content": "大学"}],
            persona={"persona": {"name": "大学生成长型学习博主"}},
        )
    )

    assert captured["options"]["forceFullDraft"] is True
    assert captured["input"]["originalUserInstruction"] == "大学"
    assert "这是内容撰写初始页的首条业务输入" in captured["input"]["userInstruction"]
    assert "主题：大学" in captured["input"]["userInstruction"]
    assert "用户原始输入：大学" in captured["input"]["userInstruction"]
    assert result["data"]["discussionOnly"] is False
    assert result["data"]["completeDraft"]["cardPreview"]["keywords"] == ["考证避坑", "新手规划"]


def test_content_complete_draft_strips_inline_tag_lines(monkeypatch) -> None:
    service = ContentService()

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "大学生成长型学习博主"}},
            "selectedTopic": selected_topic,
        }

    async def fake_run(request) -> AgentRunResponse:
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "isReadyToSave": True,
                "draft": {
                    "selectedTitle": "大学生第一次考证前，我最想知道的 5 件事",
                    "intro": "如果你也是第一次准备考证，先别急着买一堆资料。",
                    "body": [
                        "先定考试时间",
                        "再拆每周计划",
                        "标签建议：#大学生成长 #考证规划",
                    ],
                    "ending": "你第一次考证最担心哪一步？",
                    "tags": ["大学生成长", "考证规划"],
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "大学",
            "大学",
            conversation_history=[{"role": "user", "content": "大学"}],
            persona={"persona": {"name": "大学生成长型学习博主"}},
        )
    )

    assert result["data"]["completeDraft"]["body"] == ["先定考试时间", "再拆每周计划"]


def test_content_complete_draft_limits_publish_body_to_xhs_max(monkeypatch) -> None:
    service = ContentService()

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "大学生成长型学习博主"}},
            "selectedTopic": selected_topic,
        }

    async def fake_run(request) -> AgentRunResponse:
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "isReadyToSave": True,
                "draft": {
                    "selectedTitle": "第一次考证别乱买资料",
                    "intro": "开头" * 120,
                    "body": ["正文" * 400, "补充" * 300],
                    "ending": "结尾" * 120,
                    "tags": ["大学生成长", "考证规划"],
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "考证",
            "考证",
            conversation_history=[{"role": "user", "content": "考证"}],
            persona={"persona": {"name": "大学生成长型学习博主"}},
        )
    )

    draft = result["data"]["completeDraft"]
    publish_body_length = len(draft["intro"]) + sum(len(line) for line in draft["body"]) + len(draft["ending"])
    assert publish_body_length <= 1000
    assert draft["body"]


def test_format_content_text_normalizes_joined_punctuation() -> None:
    service = ContentService()

    text = service._format_content_text(
        {
            "draft": {
                "selectedTitle": "低成本自律。",
                "intro": "很多人不是不努力，而是一开始就把路径想复杂了。",
                "body": ["第一步，先明确目标。", "第二步，把任务拆成每周能完成的小动作，"],
                "ending": "如果你也经常想开始但总拖延，。",
                "tags": ["自律。", "大学生，"],
            }
        }
    )

    assert text == (
        "推荐标题：低成本自律\n\n"
        "引入：很多人不是不努力，而是一开始就把路径想复杂了。\n\n"
        "正文内容：第一步，先明确目标\n第二步，把任务拆成每周能完成的小动作\n\n"
        "结尾建议：如果你也经常想开始但总拖延\n\n"
        "标签建议：自律，大学生"
    )
