from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...services.agent_chat import UnifiedAgentChatService
from ...services.auth import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/api/agent", tags=["agent-chat"])
service = UnifiedAgentChatService()

AgentStep = Literal["persona", "trending", "content", "image_guidance", "done"]


class AgentChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    current_step: Optional[AgentStep] = None
    selected_persona_id: Optional[str] = None
    selected_topic_id: Optional[str] = None
    expose_debug: bool = False


class AgentChatHistoryRequest(BaseModel):
    limit: int = 50


@router.post("/chat")
async def chat_with_agent(
    request_body: AgentChatRequest,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else "demo-user"
    return await service.chat(
        user_id=user_id,
        message=request_body.message,
        conversation_id=request_body.conversation_id,
        current_step=request_body.current_step,
        selected_persona_id=request_body.selected_persona_id,
        selected_topic_id=request_body.selected_topic_id,
        expose_debug=request_body.expose_debug,
    )


@router.get("/conversations")
async def list_agent_chat_conversations(
    current_user: AuthenticatedUser | None = Depends(get_current_user),
    limit: int = 50,
):
    user_id = current_user.user_id if current_user else "demo-user"
    return service.list_conversations(user_id=user_id, limit=limit)


@router.get("/conversations/{conversation_id}")
async def get_agent_chat_conversation(
    conversation_id: str,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else "demo-user"
    conversation = service.get_conversation(user_id=user_id, conversation_id=conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation
