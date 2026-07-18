from typing import Any, Dict, List, Optional
from ...database.crud.persona_crud import PersonaCRUD
from ...database.crud.trend_crud import TrendCRUD
from ...database.crud.content_crud import ContentCRUD
from ...services.memory import RollingMemoryService


class ContextBuilder:
    def __init__(self, db: Optional[Any] = None):
        self.db = db
        self.persona_crud = PersonaCRUD()
        self.trend_crud = TrendCRUD()
        self.content_crud = ContentCRUD()
        self.memory_service = RollingMemoryService()

    async def build_persona_analyze_context(self, user_id: str) -> Dict[str, Any]:
        return {
            "userId": user_id,
            "history": await self._mock_get_persona_history(user_id)
        }

    async def build_persona_follow_up_context(
        self,
        user_id: str,
        basic_info: dict,
        conversation_history: list,
        conversation_scope_id: str | None = None,
    ) -> Dict[str, Any]:
        memory = self.memory_service.build_context(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="persona",
            raw_history=conversation_history,
        )
        return {
            "baseInfo": basic_info,
            "conversationHistory": memory.context_patch["conversationHistory"],
            "conversationSummary": memory.context_patch["conversationSummary"],
            "memoryMeta": memory.context_patch["memoryMeta"],
            "recentMessages": memory.context_patch["recentMessages"],
            "conversationScopeId": conversation_scope_id,
        }

    async def build_trend_track_context(
        self,
        user_id: str,
        persona: dict = None,
        conversation_history: list = None,
        summary_source_conversation: list = None,
        conversation_scope_id: str | None = None,
        current_artifact: dict | None = None,
    ) -> Dict[str, Any]:
        saved_persona = persona or await self._mock_get_saved_persona(user_id)
        if not saved_persona:
            return {}
        memory = self.memory_service.build_context(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="trend",
            raw_history=conversation_history,
            current_artifact=current_artifact,
        )
        return {
            "savedPersona": saved_persona,
            "trendHistory": await self._mock_get_trend_history(user_id),
            "conversationHistory": memory.context_patch["conversationHistory"],
            "conversationSummary": memory.context_patch["conversationSummary"],
            "memoryMeta": memory.context_patch["memoryMeta"],
            "recentMessages": memory.context_patch["recentMessages"],
            "currentArtifact": current_artifact or {},
            "conversationScopeId": conversation_scope_id,
            "summarySourceConversation": summary_source_conversation or [],
        }

    async def build_content_draft_context(
        self,
        user_id: str,
        selected_topic: Dict[str, Any],
        conversation_history: list = None,
        writing_entry_source: Dict[str, Any] | None = None,
        conversation_scope_id: str | None = None,
        current_artifact: dict | None = None,
    ) -> Dict[str, Any]:
        saved_persona = await self._mock_get_saved_persona(user_id)
        if not saved_persona:
            return {}
        memory = self.memory_service.build_context(
            user_id=user_id,
            scope_id=conversation_scope_id,
            scene="content",
            raw_history=conversation_history,
            current_artifact=current_artifact,
        )
        return {
            "savedPersona": saved_persona,
            "selectedTopic": selected_topic,
            "writingEntrySource": writing_entry_source or {},
            "latestTrendSnapshot": await self._mock_get_latest_trend_snapshot(user_id),
            "draftHistory": await self._mock_get_draft_history(user_id),
            "conversationHistory": memory.context_patch["conversationHistory"],
            "conversationSummary": memory.context_patch["conversationSummary"],
            "memoryMeta": memory.context_patch["memoryMeta"],
            "recentMessages": memory.context_patch["recentMessages"],
            "currentArtifact": current_artifact or {},
            "conversationScopeId": conversation_scope_id,
        }

    async def _mock_get_persona_history(self, user_id: str) -> List[Dict[str, Any]]:
        return []

    async def _mock_get_saved_persona(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self.persona_crud.get_persona(user_id)

    async def _mock_get_trend_history(self, user_id: str) -> List[Dict[str, Any]]:
        return self.trend_crud.get_trend_history(user_id)

    async def _mock_get_latest_trend_snapshot(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self.trend_crud.get_latest_trend_snapshot(user_id)

    async def _mock_get_draft_history(self, user_id: str) -> List[Dict[str, Any]]:
        latest = self.content_crud.get_latest_draft(user_id)
        return [latest] if latest else []
