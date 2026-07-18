from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from ...adapters.agent.client import AgentClient
from ...adapters.agent.options import build_agent_options
from ...database.crud.persona_crud import PersonaCRUD
from ...schemas.agent.protocol import AgentRunRequest
from ...services.auth import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/api", tags=["chat"])
client = AgentClient()
persona_crud = PersonaCRUD()


class ChatRequest(BaseModel):
    message: str
    userId: str = "demo-user"
    conversationHistory: Optional[List[Dict[str, Any]]] = None


@router.post("/chat")
async def chat(
    request_body: ChatRequest,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else request_body.userId
    saved_persona = persona_crud.get_persona(user_id)
    request = AgentRunRequest(
        requestId="req_general_chat",
        taskType="general.chat",
        platform="xiaohongshu",
        userId=user_id,
        input={"userMessage": request_body.message},
        context={
            "conversationHistory": request_body.conversationHistory or [],
            "savedPersona": saved_persona,
        },
        options=build_agent_options(),
    )
    response = await client.run(request)
    if response.status == "failed":
        return {"reply": (response.error or {}).get("message", "请求失败")}
    return {"reply": (response.data or {}).get("reply", "暂无回复")}
