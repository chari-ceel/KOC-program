from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from ...adapters.agent.client import AgentClient
from ...core.config import get_backend_settings
from ...database.crud.memory_crud import MemoryCRUD
from ...schemas.agent.protocol import AgentRunRequest

RECENT_MESSAGE_LIMIT = 12
VISIBLE_MESSAGE_LIMIT = 80


def _normalize_message(message: Any) -> Optional[Dict[str, str]]:
    if not isinstance(message, dict):
        return None
    role = message.get("role")
    content = message.get("content")
    if role not in {"user", "assistant"} or not isinstance(content, str):
        return None
    cleaned = content.strip()
    if not cleaned:
        return None
    return {"role": role, "content": cleaned}


def normalize_history(messages: Optional[List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for message in messages or []:
        item = _normalize_message(message)
        if item:
            normalized.append(item)
    return normalized[-VISIBLE_MESSAGE_LIMIT:]


@dataclass
class MemoryContextResult:
    context_patch: Dict[str, Any]
    state: Dict[str, Any]


class RollingMemoryService:
    def __init__(self) -> None:
        self.client = AgentClient()
        self.crud = MemoryCRUD()
        self.settings = get_backend_settings()

    def load_state(self, user_id: str, scope_id: Optional[str]) -> Dict[str, Any]:
        if not scope_id:
            return self._empty_state(scope_id="")
        return self.crud.get_memory_state(user_id, scope_id) or self._empty_state(scope_id=scope_id)

    def build_context(
        self,
        *,
        user_id: str,
        scope_id: Optional[str],
        scene: str,
        raw_history: Optional[List[Dict[str, Any]]],
        current_artifact: Optional[Dict[str, Any]] = None,
    ) -> MemoryContextResult:
        history = normalize_history(raw_history)
        state = self.load_state(user_id, scope_id)
        recent_messages = history[-RECENT_MESSAGE_LIMIT:]
        context_patch: Dict[str, Any] = {
            "conversationScopeId": scope_id,
            "conversationSummary": state.get("conversationSummary"),
            "memoryMeta": state.get("memoryMeta") or self._default_meta(scope_id),
            "recentMessages": recent_messages,
            "conversationHistory": recent_messages,
        }
        if current_artifact:
            context_patch["currentArtifact"] = current_artifact
        return MemoryContextResult(context_patch=context_patch, state=state)

    async def refresh_state(
        self,
        *,
        user_id: str,
        scope_id: Optional[str],
        scene: str,
        raw_history: Optional[List[Dict[str, Any]]],
        current_artifact: Optional[Dict[str, Any]] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        history = normalize_history(raw_history)
        if not scope_id:
            return self._empty_state(scope_id="")

        state = self.load_state(user_id, scope_id)
        previous_summary = state.get("conversationSummary")
        previous_meta = state.get("memoryMeta") or self._default_meta(scope_id)
        older_messages = history[:-RECENT_MESSAGE_LIMIT]
        target_covered_count = len(older_messages)
        covered_count = int(previous_meta.get("coveredMessageCount") or 0)

        if not force and target_covered_count <= covered_count:
            next_state = self._build_state(
                scope_id=scope_id,
                scene=scene,
                summary=previous_summary,
                covered_count=covered_count,
                status=previous_meta.get("summaryStatus") or "fresh",
            )
            self.crud.save_memory_state(user_id, scope_id, next_state)
            return next_state

        uncovered_messages = older_messages[covered_count:target_covered_count] if target_covered_count > covered_count else []
        if not uncovered_messages and not force:
            return state

        try:
            summary_payload = await self._summarize_messages(
                user_id=user_id,
                scope_id=scope_id,
                scene=scene,
                previous_summary=previous_summary,
                messages_to_summarize=uncovered_messages if not force else older_messages,
                target_covered_count=target_covered_count,
                current_artifact=current_artifact,
            )
            next_state = self._build_state(
                scope_id=scope_id,
                scene=scene,
                summary=summary_payload,
                covered_count=target_covered_count,
                status="fresh",
            )
        except Exception:
            next_state = self._build_state(
                scope_id=scope_id,
                scene=scene,
                summary=previous_summary,
                covered_count=covered_count,
                status="stale",
            )
        self.crud.save_memory_state(user_id, scope_id, next_state)
        return next_state

    async def _summarize_messages(
        self,
        *,
        user_id: str,
        scope_id: str,
        scene: str,
        previous_summary: Optional[Dict[str, Any]],
        messages_to_summarize: List[Dict[str, str]],
        target_covered_count: int,
        current_artifact: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        request = AgentRunRequest(
            requestId=f"req_memory_summary_{scope_id}",
            taskType="memory.summarize_conversation",
            platform="xiaohongshu",
            userId=user_id,
            input={
                "scene": scene,
                "targetCoveredMessageCount": target_covered_count,
                "messagesToSummarize": messages_to_summarize,
                "previousSummary": previous_summary or {},
                "currentArtifact": current_artifact or {},
            },
            context={},
            options={
                "runtimeProvider": "model",
                "debugAuth": self._build_memory_debug_auth(),
            },
        )
        response = await self.client.run(request)
        if response.status == "failed":
            raise RuntimeError((response.error or {}).get("message", "memory summarize failed"))
        data = response.data or {}
        summary = data.get("conversationSummary") if isinstance(data, dict) else None
        if not isinstance(summary, dict):
            raise RuntimeError("memory summarize returned invalid payload")
        return summary

    def _build_memory_debug_auth(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if self.settings.memory_model_api_key:
            payload["modelApiKey"] = self.settings.memory_model_api_key
        if self.settings.memory_model_base_url:
            payload["modelBaseUrl"] = self.settings.memory_model_base_url
        if self.settings.memory_model_name:
            payload["modelName"] = self.settings.memory_model_name
        return payload

    def _build_state(
        self,
        *,
        scope_id: str,
        scene: str,
        summary: Optional[Dict[str, Any]],
        covered_count: int,
        status: str,
    ) -> Dict[str, Any]:
        return {
            "conversationSummary": summary or {},
            "memoryMeta": {
                "scopeId": scope_id,
                "scene": scene,
                "summaryStatus": status,
                "coveredMessageCount": covered_count,
                "updatedAt": datetime.utcnow().isoformat(),
                "recentMessageLimit": RECENT_MESSAGE_LIMIT,
                "visibleMessageLimit": VISIBLE_MESSAGE_LIMIT,
            },
        }

    def _empty_state(self, scope_id: str) -> Dict[str, Any]:
        return {
            "conversationSummary": {},
            "memoryMeta": self._default_meta(scope_id),
        }

    def _default_meta(self, scope_id: Optional[str]) -> Dict[str, Any]:
        return {
            "scopeId": scope_id or "",
            "summaryStatus": "fresh",
            "coveredMessageCount": 0,
            "updatedAt": datetime.utcnow().isoformat(),
            "recentMessageLimit": RECENT_MESSAGE_LIMIT,
            "visibleMessageLimit": VISIBLE_MESSAGE_LIMIT,
        }
