import logging
import os
from typing import Optional

import httpx
from pydantic import ValidationError

from ...schemas.agent.protocol import AgentRunRequest, AgentRunResponse

logger = logging.getLogger(__name__)


class AgentClient:
    def __init__(self, base_url: Optional[str] = None, timeout: int | None = None):
        self.logger = logging.getLogger(__name__)
        self.base_url = (base_url or os.getenv("AGENT_BASE_URL", "http://127.0.0.1:8010")).rstrip("/")
        self.timeout = timeout or int(os.getenv("AGENT_REQUEST_TIMEOUT_SECONDS", "180"))

    async def run(self, request: AgentRunRequest) -> AgentRunResponse:
        target_url = f"{self.base_url}/agent/run"
        async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
            try:
                response = await client.post(target_url, json=request.model_dump())
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError(f"Agent response payload must be a JSON object, got {type(payload).__name__}")
                return AgentRunResponse(**payload)
            except httpx.HTTPStatusError as exc:
                self.logger.error("Agent HTTP error while receiving agent output: %s %s", exc.response.status_code, exc.response.text)
                return self._failed_response(request, f"Agent HTTP error: {exc.response.status_code} {exc.response.text}")
            except httpx.TimeoutException as exc:
                self.logger.error("Agent request timed out after %ss: %s", self.timeout, target_url, exc_info=True)
                return self._failed_response(request, f"Agent request timed out after {self.timeout}s")
            except (httpx.HTTPError, ValidationError, ValueError) as exc:
                self.logger.error("Agent output parsing failed: %s", str(exc), exc_info=True)
                return self._failed_response(request, f"Agent output parsing failed: {str(exc)}")
            except Exception as exc:
                self.logger.exception("Unexpected exception while receiving agent output")
                return self._failed_response(request, f"Agent output handling failed: {str(exc)}")

    def _failed_response(self, request: AgentRunRequest, message: str) -> AgentRunResponse:
        return AgentRunResponse(
            requestId=request.requestId,
            taskType=request.taskType,
            platform=request.platform,
            status="failed",
            data={},
            savePayload={},
            warnings=[],
            error={"message": message}
        )
