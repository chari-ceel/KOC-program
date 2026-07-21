from pathlib import Path


PROMPT_FILES = {
    "persona.analyze": "persona.prompt.md",
    "persona.follow_up": "persona.prompt.md",
    "trend.track": "trend-tracking.prompt.md",
    "topic.recommend": "trend-tracking.prompt.md",
    "content.draft": "xhs-content-writing.prompt.md",
    "content.revise": "xhs-content-writing.prompt.md",
    "general.chat": "general-chat.prompt.md",
}

SKILL_FILES = {
    "human_voice": "skills/human-voice.skill.md",
}

TASK_SKILLS = {
    "persona.analyze": ["human_voice"],
    "persona.follow_up": ["human_voice"],
    "trend.track": ["human_voice"],
    "topic.recommend": ["human_voice"],
    "content.draft": ["human_voice"],
    "content.revise": ["human_voice"],
}


class PromptLoader:
    def __init__(self, prompt_dir: Path | None = None) -> None:
        self.prompt_dir = prompt_dir or self._default_prompt_dir()

    def _default_prompt_dir(self) -> Path:
        current = Path(__file__).resolve()
        for parent in current.parents:
            candidate = parent / "prompts"
            if candidate.exists() and any((candidate / file_name).exists() for file_name in PROMPT_FILES.values()):
                return candidate
        return current.parents[3] / "prompts"

    def get_prompt_path(self, task_type: str) -> Path:
        file_name = PROMPT_FILES.get(task_type)
        if not file_name:
            raise KeyError(f"No prompt configured for taskType: {task_type}")
        return self.prompt_dir / file_name

    def get_skill_path(self, skill_name: str) -> Path:
        file_name = SKILL_FILES.get(skill_name)
        if not file_name:
            raise KeyError(f"No skill configured: {skill_name}")
        return self.prompt_dir / file_name

    def load(self, task_type: str) -> str:
        prompt_path = self.get_prompt_path(task_type)
        return prompt_path.read_text(encoding="utf-8")

    def load_skill(self, skill_name: str) -> str:
        skill_path = self.get_skill_path(skill_name)
        return skill_path.read_text(encoding="utf-8")

    def skills_for_task(self, task_type: str) -> list[str]:
        return TASK_SKILLS.get(task_type, [])

    def load_skills_for_task(self, task_type: str) -> list[tuple[str, str]]:
        return [(skill_name, self.load_skill(skill_name)) for skill_name in self.skills_for_task(task_type)]
