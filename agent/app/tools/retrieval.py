from __future__ import annotations

import time
from typing import Protocol

from app.schemas.tools import (
    RetrievalToolRequest,
    RetrievalToolResult,
    Source,
    ToolCall,
    ToolError,
)


class RetrievalTool(Protocol):
    name: str

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        """Run a retrieval request and return a normalized result."""


def result_to_sources(result: RetrievalToolResult) -> list[Source]:
    if result.status != "success":
        return []
    return [
        Source(
            sourceType=result.source,
            title=item.title,
            url=item.url,
            summary=item.summary,
            retrievedAt=item.retrievedAt,
        )
        for item in result.items
    ]


def build_tool_call(
    *,
    request: RetrievalToolRequest,
    result: RetrievalToolResult,
    duration_ms: int,
    tool_name: str = "retrieval.search",
) -> ToolCall:
    status = "success" if result.status == "success" else "failed"
    return ToolCall(
        toolName=tool_name,
        toolType="retrieval",
        status=status,
        inputSummary={
            "source": request.source,
            "query": request.query,
            "queries": (request.filters or {}).get("queries"),
            "sourcePreference": (request.filters or {}).get("sourcePreference"),
            "platform": request.platform,
            "limit": request.limit,
        },
        outputSummary={"itemCount": len(result.items), "status": result.status},
        durationMs=duration_ms,
        error=result.error,
    )


def unavailable_result(
    request: RetrievalToolRequest,
    *,
    message: str,
    code: str = "TOOL_UNAVAILABLE",
) -> RetrievalToolResult:
    return RetrievalToolResult(
        source=request.source,
        status="failed",
        items=[],
        error=ToolError(
            code=code,
            message=message,
            details={"source": request.source},
        ),
    )


def timed_search(
    tool: RetrievalTool, request: RetrievalToolRequest
) -> tuple[RetrievalToolResult, ToolCall]:
    started = time.perf_counter()
    try:
        result = tool.search(request)
    except Exception as exc:  # Keep tool failures from crashing workflows.
        result = unavailable_result(request, message=str(exc))
    duration_ms = int((time.perf_counter() - started) * 1000)
    return result, build_tool_call(request=request, result=result, duration_ms=duration_ms)
