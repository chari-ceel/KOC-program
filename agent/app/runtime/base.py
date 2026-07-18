from abc import ABC, abstractmethod
from typing import Any

from app.schemas.agent import AgentRunRequest, AgentRunResponse
from app.schemas.tools import RetrievalToolRequest


class ModelRuntime(ABC):
    """Abstract runtime used by workflows to generate task responses."""

    @abstractmethod
    def generate(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> AgentRunResponse:
        raise NotImplementedError

    def decide_retrieval(
        self,
        request: AgentRunRequest,
        prompt: str | None = None,
        variables: dict[str, Any] | None = None,
    ) -> RetrievalToolRequest | None:
        return None
