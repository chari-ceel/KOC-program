from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/agent", tags=["agent-chat"])

AgentStep = Literal["persona", "trending", "content", "image_guidance", "done"]
CHINA_TZ = timezone(timedelta(hours=8))


class AgentChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    current_step: Optional[AgentStep] = None
    selected_persona_id: Optional[str] = None
    selected_topic_id: Optional[str] = None


@router.post("/chat")
async def chat_with_agent(request_body: AgentChatRequest):
    conversation_id = request_body.conversation_id or f"conv_{uuid4().hex[:8]}"
    message_id = f"msg_{uuid4().hex[:8]}"
    persona_memory_id = request_body.selected_persona_id or "persona_001"

    return {
        "conversation_id": conversation_id,
        "assistant_message": {
            "id": message_id,
            "role": "assistant",
            "content": (
                "好的，我们先从人设打造开始。根据你的描述，我会先帮你整理一个适合"
                "小红书的账号定位。"
            ),
            "created_at": datetime.now(CHINA_TZ).isoformat(),
        },
        "current_step": "persona",
        "next_step": "trending",
        "summary": {
            "persona": {
                "done": True,
                "title": "人设打造",
                "text": "真实分享型小红书博主，主打经验总结、避坑建议和实用内容。",
                "message_id": message_id,
                "memory_id": persona_memory_id,
            },
            "trending": {
                "done": False,
                "title": "热门追踪",
                "text": "",
                "message_id": None,
                "memory_id": None,
            },
            "content": {
                "done": False,
                "title": "内容撰写",
                "text": "",
                "message_id": None,
                "memory_id": None,
            },
        },
        "memory_refs": {
            "conversation_memory_id": f"conv_mem_{conversation_id.removeprefix('conv_')}",
            "persona_memory_id": persona_memory_id,
            "trending_memory_id": None,
            "content_memory_id": None,
        },
    }
