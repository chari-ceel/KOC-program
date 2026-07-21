import pytest

from app.prompts.loader import PromptLoader
from app.schemas.agent import AgentRunRequest
from app.workflows.base import BaseWorkflow


def _request(task_type: str, options: dict | None = None) -> AgentRunRequest:
    return AgentRunRequest(
        requestId=f"req_{task_type}",
        taskType=task_type,
        platform="xiaohongshu",
        userId="user-1",
        input={},
        context={},
        options=options or {},
    )


def _workflow_with_prompts(tmp_path) -> BaseWorkflow:
    for file_name in (
        "persona.prompt.md",
        "trend-tracking.prompt.md",
        "xhs-content-writing.prompt.md",
        "general-chat.prompt.md",
    ):
        (tmp_path / file_name).write_text(f"# {file_name}", encoding="utf-8")
    skill_dir = tmp_path / "skills"
    skill_dir.mkdir()
    (skill_dir / "human-voice.skill.md").write_text("# Human Voice Skill", encoding="utf-8")
    workflow = BaseWorkflow()
    workflow.prompt_loader = PromptLoader(tmp_path)
    return workflow


def test_persona_trend_and_content_prompts_include_human_voice_skill(tmp_path) -> None:
    workflow = _workflow_with_prompts(tmp_path)

    for task_type in ("persona.analyze", "trend.track", "content.draft", "content.revise"):
        prompt = workflow._prompt_for_request(_request(task_type))

        assert prompt is not None
        assert "## Applied Skill: human_voice" in prompt
        assert "# Human Voice Skill" in prompt


def test_general_chat_does_not_include_human_voice_skill_by_default(tmp_path) -> None:
    workflow = _workflow_with_prompts(tmp_path)

    prompt = workflow._prompt_for_request(_request("general.chat"))

    assert prompt is not None
    assert "## Applied Skill: human_voice" not in prompt


def test_prompt_override_still_includes_human_voice_skill(tmp_path) -> None:
    workflow = _workflow_with_prompts(tmp_path)

    prompt = workflow._prompt_for_request(
        _request("content.draft", {"promptOverride": "custom content prompt"})
    )

    assert prompt is not None
    assert prompt.startswith("custom content prompt")
    assert "## Applied Skill: human_voice" in prompt


def test_missing_human_voice_skill_is_not_silent(tmp_path) -> None:
    (tmp_path / "persona.prompt.md").write_text("persona prompt", encoding="utf-8")
    workflow = BaseWorkflow()
    workflow.prompt_loader = PromptLoader(tmp_path)

    with pytest.raises(FileNotFoundError):
        workflow._prompt_for_request(_request("persona.analyze"))
