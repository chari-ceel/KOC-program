import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.schemas.agent import AgentRunRequest, AgentRunResponse


MOCK_RESPONSE_FILES = {
    "persona.analyze": "persona.analyze.success.json",
    "persona.follow_up": "persona.follow_up.success.json",
    "general.chat": "general.chat.success.json",
    "memory.summarize_conversation": "memory.summarize_conversation.success.json",
    "trend.track": "trend.track.success.json",
    "topic.recommend": "topic.recommend.success.json",
    "content.draft": "content.draft.success.json",
    "content.revise": "content.revise.success.json",
}


class MockResponseLoader:
    def __init__(self, examples_dir: Path | None = None) -> None:
        self.examples_dir = examples_dir or self._default_examples_dir()

    def _default_examples_dir(self) -> Path:
        current = Path(__file__).resolve()
        for parent in current.parents:
            candidate = parent / "examples" / "agent-responses"
            if candidate.exists():
                return candidate
        return current.parents[3] / "examples" / "agent-responses"

    def load(self, request: AgentRunRequest) -> AgentRunResponse:
        file_name = MOCK_RESPONSE_FILES[request.task_type]
        response_path = self.examples_dir / file_name
        payload = json.loads(response_path.read_text(encoding="utf-8"))
        patched = self._patch_envelope(payload, request)
        return AgentRunResponse.model_validate(patched)

    def _patch_envelope(
        self,
        payload: dict[str, Any],
        request: AgentRunRequest,
    ) -> dict[str, Any]:
        patched = deepcopy(payload)
        patched["requestId"] = request.request_id
        patched["taskType"] = request.task_type
        patched["platform"] = request.platform
        patched.setdefault("metadata", {})
        patched["metadata"]["agentVersion"] = get_settings().version
        patched["metadata"]["runtimeMode"] = "mock"
        patched["metadata"]["mockResponse"] = True
        return patched
