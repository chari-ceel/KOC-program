from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from ...schemas.requests import DraftContentRequest, ContentSaveRequest
from ...schemas.responses import StandardResponse
from ...services.content.service import ContentService
from ...adapters.outputs import output_manager
from ...services.auth import AuthenticatedUser, require_current_user
from typing import Dict, Any

router = APIRouter(prefix="/api/content", tags=["content"])
service = ContentService()


async def _call_draft_service(request_body: DraftContentRequest, current_user: AuthenticatedUser, draft_kwargs: dict):
    if request_body.conversationScopeId:
        try:
            return await service.draft(
                current_user.user_id,
                request_body.topic,
                request_body.instruction,
                conversation_history=request_body.conversationHistory,
                current_draft=request_body.currentDraft,
                revision_instruction=request_body.revisionInstruction,
                writing_entry_source=request_body.writingEntrySource,
                persona=request_body.persona,
                prompt_override=request_body.promptOverride,
                conversation_scope_id=request_body.conversationScopeId,
                **draft_kwargs,
            )
        except TypeError:
            pass

    return await service.draft(
        current_user.user_id,
        request_body.topic,
        request_body.instruction,
        request_body.conversationHistory,
        request_body.currentDraft,
        request_body.revisionInstruction,
        request_body.writingEntrySource,
        request_body.persona,
        request_body.promptOverride,
        **draft_kwargs,
    )


@router.post("/draft", response_model=StandardResponse, response_model_exclude_none=True)
async def draft_content(
    request_body: DraftContentRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    draft_kwargs = {}
    if request_body.agentDebug:
        draft_kwargs["agent_debug"] = request_body.agentDebug.model_dump(exclude_none=True)
    result = await _call_draft_service(request_body, current_user, draft_kwargs)
    if result.get("status") == "failed":
        error_message = result.get("message", "Agent 调用失败")
        response = {
            "code": 500,
            "message": error_message,
            "msg": error_message,
            "debug": result.get("debug"),
        }
        await output_manager.send_to_channels(request_body.outputChannels or ["frontend"], response, current_user.user_id)
        return JSONResponse(status_code=500, content=response)

    response = {
        "code": 200,
        "data": result["data"],
        "warnings": result["warnings"],
        "debug": result.get("debug"),
    }
    await output_manager.send_to_channels(request_body.outputChannels or ["frontend"], response, current_user.user_id)
    return response


@router.post("/save", response_model=StandardResponse, response_model_exclude_none=True)
async def save_content_draft(
    request_body: ContentSaveRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    result = service.save_draft_record(current_user.user_id, request_body.draft)
    response = {"code": 200, "data": result["data"]}
    return response


@router.delete("/record", response_model=StandardResponse, response_model_exclude_none=True)
async def delete_my_content_draft(
    draft: Dict[str, Any],
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    return _delete_content_response(current_user.user_id, draft)


@router.delete("/{user_id}/record", response_model=StandardResponse, response_model_exclude_none=True)
async def delete_content_draft(
    user_id: str,
    draft: Dict[str, Any],
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    return _delete_content_response(current_user.user_id, draft)


def _delete_content_response(user_id: str, draft: Dict[str, Any]):
    result = service.delete_draft_record(user_id, draft)
    if result["status"] == "failed":
        return {"code": 404, "message": "Draft not found"}
    return {"code": 200, "message": result["message"]}


@router.get("/history", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_content_history(current_user: AuthenticatedUser = Depends(require_current_user)):
    return _content_history_response(current_user.user_id)


@router.get("/{user_id}/history", response_model=StandardResponse, response_model_exclude_none=True)
async def get_content_history(user_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    return _content_history_response(current_user.user_id)


def _content_history_response(user_id: str):
    history = service.get_draft_history(user_id)
    return {"code": 200, "data": {"contentHistory": history}}
