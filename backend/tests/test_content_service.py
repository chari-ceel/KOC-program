from backend.app.schemas.agent.protocol import AgentRunResponse
from backend.app.services.content.service import ContentService


def test_content_initial_page_first_turn_forces_full_draft(monkeypatch) -> None:
    service = ContentService()
    captured = {}

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "test persona"}},
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
                "reply": "done",
                "isReadyToSave": True,
                "draft": {
                    "selectedTitle": "Study Plan",
                    "intro": "Intro",
                    "body": ["Body 1", "Body 2"],
                    "ending": "Ending",
                    "tags": ["tag-one", "tag-two"],
                    "cardPreview": {"keywords": ["keyword-one", "keyword-two"]},
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "Study",
            "Study",
            conversation_history=[{"role": "user", "content": "Study"}],
            persona={"persona": {"name": "test persona"}},
        )
    )

    assert captured["options"]["forceFullDraft"] is True
    assert captured["input"]["originalUserInstruction"] == "Study"
    assert captured["input"]["topic"] == "Study"
    assert captured["input"]["selectedTitle"] == "Study"
    assert result["data"]["discussionOnly"] is False
    assert result["data"]["completeDraft"]["title"] == "Study"


def test_content_revise_keeps_existing_title_by_default(monkeypatch) -> None:
    service = ContentService()
    captured = {}

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        captured["selected_topic"] = selected_topic
        return {
            "savedPersona": {"persona": {"name": "test persona"}},
            "selectedTopic": selected_topic,
        }

    async def fake_run(request) -> AgentRunResponse:
        captured["input"] = request.input
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="success",
            data={
                "isReadyToSave": True,
                "revisedDraft": {
                    "selectedTitle": "New Title B",
                    "intro": "Revised intro.",
                    "body": ["First paragraph", "Second paragraph"],
                    "ending": "Which ending feels better?",
                    "tags": ["tag-one", "tag-two"],
                    "cardPreview": {"keywords": ["keyword-one", "keyword-two"]},
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    current_draft = {
        "selectedTitle": "Original Title A",
        "intro": "Original intro.",
        "body": ["Original body one", "Original body two"],
        "ending": "Original ending.",
        "tags": ["tag-one", "tag-two"],
    }

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "Original Title A",
            "Make the ending more natural.",
            conversation_history=[{"role": "user", "content": "Make the ending more natural."}],
            current_draft=current_draft,
            revision_instruction="Make the ending more natural.",
            persona={"persona": {"name": "test persona"}},
        )
    )

    assert captured["selected_topic"]["selectedTitle"] == "Original Title A"
    assert captured["input"]["topic"] == "Original Title A"
    assert captured["input"]["selectedTitle"] == "Original Title A"
    assert captured["input"]["revisionInstruction"] == "Make the ending more natural."
    assert result["data"]["completeDraft"]["title"] == "Original Title A"
    assert result["data"]["completeDraft"]["selectedTitle"] == "Original Title A"
    assert result["data"]["completeDraft"]["titleOptions"][0] == "Original Title A"


def test_content_complete_draft_limits_publish_body_to_xhs_max(monkeypatch) -> None:
    service = ContentService()

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "test persona"}},
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
                    "selectedTitle": "Exam Prep",
                    "intro": "A" * 120,
                    "body": ["B" * 400, "C" * 300],
                    "ending": "D" * 120,
                    "tags": ["tag-one", "tag-two"],
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "Exam Prep",
            "Exam Prep",
            conversation_history=[{"role": "user", "content": "Exam Prep"}],
            persona={"persona": {"name": "test persona"}},
        )
    )

    draft = result["data"]["completeDraft"]
    publish_body_length = len(draft["intro"]) + sum(len(line) for line in draft["body"]) + len(draft["ending"])
    assert publish_body_length <= 1000
    assert draft["body"]


def test_content_complete_draft_strips_inline_tag_lines(monkeypatch) -> None:
    service = ContentService()

    async def fake_build_context(user_id: str, selected_topic: dict, conversation_history: list | None, writing_entry_source: dict | None) -> dict:
        return {
            "savedPersona": {"persona": {"name": "test persona"}},
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
                    "selectedTitle": "Plan",
                    "intro": "Intro",
                    "body": ["Step 1", "tags: #tag-one #tag-two"],
                    "ending": "Ending",
                    "tags": ["tag-one", "tag-two"],
                },
            },
            warnings=[],
        )

    monkeypatch.setattr(service.builder, "build_content_draft_context", fake_build_context)
    monkeypatch.setattr(service.client, "run", fake_run)

    result = __import__("asyncio").run(
        service.draft(
            "user-1",
            "Plan",
            "Plan",
            conversation_history=[{"role": "user", "content": "Plan"}],
            persona={"persona": {"name": "test persona"}},
        )
    )

    assert result["data"]["completeDraft"]["body"] == ["Step 1"]
