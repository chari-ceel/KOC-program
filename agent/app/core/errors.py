from typing import Any

from app.schemas.agent import AgentRunRequest, AgentRunResponse


INVALID_REQUEST = "INVALID_REQUEST"
UNSUPPORTED_TASK_TYPE = "UNSUPPORTED_TASK_TYPE"
UNSUPPORTED_PLATFORM = "UNSUPPORTED_PLATFORM"
MISSING_CONTEXT = "MISSING_CONTEXT"
TOOL_UNAVAILABLE = "TOOL_UNAVAILABLE"
INTERNAL_ERROR = "INTERNAL_ERROR"
RESERVED_FEATURE = "RESERVED_FEATURE"
MODEL_PROVIDER_UNAVAILABLE = "MODEL_PROVIDER_UNAVAILABLE"


def failed_response(
    request: AgentRunRequest,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> AgentRunResponse:
    return AgentRunResponse(
        requestId=request.request_id,
        taskType=request.task_type,
        platform=request.platform,
        status="failed",
        data={},
        savePayload={},
        sources=[],
        toolCalls=[],
        warnings=[],
        error={
            "code": code,
            "message": message,
            "details": details or {},
        },
        metadata={},
    )
