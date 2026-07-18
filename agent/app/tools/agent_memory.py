from app.core.errors import RESERVED_FEATURE
from app.schemas.tools import ReservedToolResult, ToolError


class AgentMemoryTool:
    tool_type = "agent_memory"

    def query(self, *, user_id: str, key: str | None = None) -> ReservedToolResult:
        return ReservedToolResult(
            toolType=self.tool_type,
            error=ToolError(
                code=RESERVED_FEATURE,
                message="AgentMemoryTool is reserved for a later phase.",
                details={"userId": user_id, "key": key},
            ),
        )

    def write(self, *, user_id: str, key: str, value: object) -> ReservedToolResult:
        return ReservedToolResult(
            toolType=self.tool_type,
            error=ToolError(
                code=RESERVED_FEATURE,
                message="AgentMemoryTool writes are reserved for a later phase.",
                details={"userId": user_id, "key": key},
            ),
        )
