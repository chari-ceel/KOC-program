from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional


class AgentRunRequest(BaseModel):
    requestId: str
    taskType: str
    platform: str
    userId: str
    input: Dict[str, Any]
    context: Dict[str, Any]
    options: Dict[str, Any] = Field(default_factory=dict)


class AgentRunResponse(BaseModel):
    requestId: str
    taskType: str
    platform: str
    status: str
    data: Optional[Dict[str, Any]] = Field(default_factory=dict)
    savePayload: Optional[Dict[str, Any]] = None
    sources: List[Dict[str, Any]] = Field(default_factory=list)
    toolCalls: List[Dict[str, Any]] = Field(default_factory=list)
    warnings: List[Dict[str, Any]] = Field(default_factory=list)
    error: Optional[Dict[str, Any]] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
