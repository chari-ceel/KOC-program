from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentJobCreateRequest(BaseModel):
    requestId: str | None = None
    taskType: str
    platform: str = "xiaohongshu"
    userId: str
    input: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class AgentJobResponse(BaseModel):
    status: Literal["reserved"] = "reserved"
    jobId: str | None = None
    error: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
