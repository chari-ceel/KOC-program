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

    def load(self, task_type: str) -> str:
        prompt_path = self.get_prompt_path(task_type)
        return prompt_path.read_text(encoding="utf-8")
