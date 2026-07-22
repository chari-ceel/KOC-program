import inspect
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
    action_type: Optional[
        Literal["message", "quick_reply", "approve_step", "choose_topic", "revise_content", "regenerate", "save"]
    ] = "message"
    action_payload: Optional[Dict[str, Any]] = None
    expose_debug: bool = False


class AgentChatHistoryRequest(BaseModel):
    limit: int = 50


class AgentConversationFromPersonaRequest(BaseModel):
    persona_record_id: str


@router.post("/conversations")
async def create_agent_chat_conversation(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else "demo-user"
    result = service.create_conversation(user_id=user_id)
    if inspect.isawaitable(result):
        result = await result
    if (
        isinstance(result, dict)
        and isinstance(result.get("conversation_id"), str)
        and result.get("create_status") == "questions_pending"
    ):
        background_tasks.add_task(
            service.generate_initial_persona_questions,
            user_id=user_id,
            conversation_id=result["conversation_id"],
        )
    return result


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
        action_type=request_body.action_type or "message",
        action_payload=request_body.action_payload or {},
        expose_debug=request_body.expose_debug,
    )


@router.post("/conversations/from-persona")
async def create_agent_chat_conversation_from_persona(
    request_body: AgentConversationFromPersonaRequest,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else "demo-user"
    conversation = service.start_conversation_from_persona(
        user_id=user_id,
        persona_record_id=request_body.persona_record_id,
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Persona record not found")
    return conversation


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


@router.delete("/conversations/{conversation_id}")
async def delete_agent_chat_conversation(
    conversation_id: str,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else "demo-user"
    return service.delete_conversation(user_id=user_id, conversation_id=conversation_id)
