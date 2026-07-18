from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


RetrievalSource = Literal[
    "web_search",
    "browser_search",
    "xhs_fetcher",
    "builtin_trend_store",
    "official_rule_store",
]

RetrievalStatus = Literal["success", "empty", "failed"]
ToolCallStatus = Literal["success", "failed", "skipped"]


class ToolWarning(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ToolError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class RetrievalMetrics(BaseModel):
    likes: int | None = None
    saves: int | None = None
    comments: int | None = None
    shares: int | None = None


class RetrievalItem(BaseModel):
    title: str
    url: str | None = None
    summary: str
    platform: str | None = None
    contentType: str | None = None
    publishedAt: str | None = None
    retrievedAt: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    metrics: RetrievalMetrics = Field(default_factory=RetrievalMetrics)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RetrievalToolRequest(BaseModel):
    toolType: Literal["retrieval"] = "retrieval"
    source: RetrievalSource
    query: str
    platform: str = "xiaohongshu"
    limit: int = 10
    filters: dict[str, Any] = Field(default_factory=dict)
    timeoutMs: int = 8000


class RetrievalToolResult(BaseModel):
    source: RetrievalSource
    status: RetrievalStatus = "success"
    items: list[RetrievalItem] = Field(default_factory=list)
    warnings: list[ToolWarning] = Field(default_factory=list)
    error: ToolError | None = None


class Source(BaseModel):
    sourceType: RetrievalSource
    title: str
    url: str | None = None
    summary: str
    retrievedAt: str


class ToolCall(BaseModel):
    toolName: str
    toolType: str
    status: ToolCallStatus
    inputSummary: dict[str, Any] = Field(default_factory=dict)
    outputSummary: dict[str, Any] = Field(default_factory=dict)
    durationMs: int
    error: ToolError | None = None


class ReservedToolResult(BaseModel):
    toolType: str
    status: Literal["reserved"] = "reserved"
    error: ToolError
    data: dict[str, Any] = Field(default_factory=dict)
