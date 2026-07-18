from app.core.errors import RESERVED_FEATURE
from app.schemas.tools import ReservedToolResult, ToolError


class ContextProviderTool:
    tool_type = "context_provider"

    def query_user_context(
        self,
        *,
        user_id: str,
        fields: list[str],
    ) -> ReservedToolResult:
        return ReservedToolResult(
            toolType=self.tool_type,
            error=ToolError(
                code=RESERVED_FEATURE,
                message="ContextProviderTool is reserved for a later phase.",
                details={"userId": user_id, "fields": fields},
            ),
        )
