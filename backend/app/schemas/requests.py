from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional


class AgentDebugRequest(BaseModel):
    enableTools: Optional[bool] = None
    requireRealWebResearch: Optional[bool] = None
    maxToolCalls: Optional[int] = None
    contentType: Optional[str] = None
    language: Optional[str] = None
    exposeAgentDetails: bool = False
    debugAuth: Optional[Dict[str, Any]] = None


class PersonaAnalyzeRequest(BaseModel):
    userId: str = "demo-user"
    basicInfo: Dict[str, Any]
    outputChannels: Optional[List[str]] = ["frontend"]
    agentDebug: Optional[AgentDebugRequest] = None


class PersonaSaveRequest(BaseModel):
    userId: str = "demo-user"
    persona: Dict[str, Any]


class PersonaFavoriteRequest(BaseModel):
    recordId: str
    isFavorited: bool = True


class PersonaFollowUpRequest(BaseModel):
    userId: str = "demo-user"
    basicInfo: Dict[str, Any]
    userMessage: str
    conversationScopeId: Optional[str] = None
    conversationHistory: Optional[List[Dict[str, Any]]] = None
    promptOverride: Optional[str] = None
    outputChannels: Optional[List[str]] = ["frontend"]
    agentDebug: Optional[AgentDebugRequest] = None


class TrendTrackRequest(BaseModel):
    userId: str = "demo-user"
    preference: str = ""
    persona: Optional[Dict[str, Any]] = None
    conversationScopeId: Optional[str] = None
    conversationHistory: Optional[List[Dict[str, Any]]] = None
    summarySourceConversation: Optional[List[Dict[str, Any]]] = None
    summaryMode: Optional[Literal["realtime_progress"]] = None
    promptOverride: Optional[str] = None
    outputChannels: Optional[List[str]] = ["frontend"]
    agentDebug: Optional[AgentDebugRequest] = None


class DraftContentRequest(BaseModel):
    userId: str = "demo-user"
    topic: str
    instruction: Optional[str] = ""
    currentDraft: Optional[Dict[str, Any]] = None
    revisionInstruction: Optional[str] = None
    conversationScopeId: Optional[str] = None
    conversationHistory: Optional[List[Dict[str, Any]]] = None
    writingEntrySource: Optional[Dict[str, Any]] = None
    persona: Optional[Dict[str, Any]] = None
    promptOverride: Optional[str] = None
    outputChannels: Optional[List[str]] = ["frontend"]
    agentDebug: Optional[AgentDebugRequest] = None


class TrendSaveRequest(BaseModel):
    userId: str = "demo-user"
    record: Dict[str, Any]


class ContentSaveRequest(BaseModel):
    userId: str = "demo-user"
    draft: Dict[str, Any]


AnalyticsModule = Literal["dialog", "profile", "trending", "content"]
AnalyticsEventName = Literal[
    "agent_output_copy",
    "conversation_turn_started",
    "conversation_turn_completed",
    "conversation_turn_failed",
]


class AnalyticsEventRequest(BaseModel):
    eventName: AnalyticsEventName
    module: AnalyticsModule
    conversationId: Optional[str] = None
    messageId: Optional[str] = None
    requestId: Optional[str] = None
    taskType: Optional[str] = None
    messageIndex: Optional[int] = None
    messageRole: Optional[Literal["assistant", "user"]] = None
    contentLength: Optional[int] = None
    contentHash: Optional[str] = None
    copySource: Optional[str] = None
    turnIndex: Optional[int] = None
    userMessageLength: Optional[int] = None
    assistantMessageLength: Optional[int] = None
    historyMessageCount: Optional[int] = None
    status: Optional[str] = None
    latencyMs: Optional[int] = None
    failureReason: Optional[str] = None

    def to_storage_payload(self) -> Dict[str, Any]:
        return {
            "conversation_id": self.conversationId,
            "message_id": self.messageId,
            "request_id": self.requestId,
            "task_type": self.taskType,
            "message_index": self.messageIndex,
            "message_role": self.messageRole,
            "content_length": self.contentLength,
            "content_hash": self.contentHash,
            "copy_source": self.copySource,
            "turn_index": self.turnIndex,
            "user_message_length": self.userMessageLength,
            "assistant_message_length": self.assistantMessageLength,
            "history_message_count": self.historyMessageCount,
            "status": self.status,
            "latency_ms": self.latencyMs,
            "failure_reason": self.failureReason,
        }
