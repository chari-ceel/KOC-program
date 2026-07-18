from typing import Any, Literal

from pydantic import BaseModel, Field


AgentStatus = Literal["success", "partial_success", "failed"]


class AgentError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class AgentWarning(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class SavePayload(BaseModel):
    type: str | None = None
    suggested_collection: str | None = Field(default=None, alias="suggestedCollection")
    data: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class AgentRunRequest(BaseModel):
    request_id: str | None = Field(default=None, alias="requestId")
    task_type: str = Field(alias="taskType")
    platform: str
    user_id: str = Field(alias="userId")
    input: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class AgentRunResponse(BaseModel):
    request_id: str | None = Field(default=None, alias="requestId")
    task_type: str = Field(alias="taskType")
    platform: str
    status: AgentStatus
    data: dict[str, Any] | None = Field(default_factory=dict)
    save_payload: dict[str, Any] | None = Field(default_factory=dict, alias="savePayload")
    sources: list[dict[str, Any]] = Field(default_factory=list)
    tool_calls: list[dict[str, Any]] = Field(default_factory=list, alias="toolCalls")
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}
