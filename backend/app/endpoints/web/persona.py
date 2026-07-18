from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from ...schemas.requests import PersonaAnalyzeRequest, PersonaFavoriteRequest, PersonaSaveRequest, PersonaFollowUpRequest
from ...schemas.responses import StandardResponse
from ...services.persona import PersonaService
from ...adapters.outputs import output_manager
from ...services.auth import AuthenticatedUser, get_current_user, require_current_user

router = APIRouter(prefix="/api/persona", tags=["persona"])
service = PersonaService()
GUEST_USER_ID = "guest-user"


async def _call_follow_up_service(request_body: PersonaFollowUpRequest, current_user: AuthenticatedUser, follow_up_kwargs: dict):
    if request_body.conversationScopeId:
        try:
            return await service.follow_up(
                current_user.user_id,
                request_body.basicInfo,
                request_body.userMessage,
                conversation_history=request_body.conversationHistory,
                prompt_override=request_body.promptOverride,
                conversation_scope_id=request_body.conversationScopeId,
                **follow_up_kwargs,
            )
        except TypeError:
            pass

    return await service.follow_up(
        current_user.user_id,
        request_body.basicInfo,
        request_body.userMessage,
        request_body.conversationHistory,
        request_body.promptOverride,
        **follow_up_kwargs,
    )


@router.post("/analyze", response_model=StandardResponse, response_model_exclude_none=True)
async def analyze_persona(
    request_body: PersonaAnalyzeRequest,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    user_id = current_user.user_id if current_user else GUEST_USER_ID
    analyze_kwargs = {}
    if request_body.agentDebug:
        analyze_kwargs["agent_debug"] = request_body.agentDebug.model_dump(exclude_none=True)
    if current_user:
        result = await service.analyze(
            user_id,
            request_body.basicInfo,
            **analyze_kwargs,
        )
    else:
        result = await service.analyze(
            user_id,
            request_body.basicInfo,
            persist=False,
            **analyze_kwargs,
        )
    if result.get("status") == "failed":
        error_message = result.get("message", "Agent 调用失败")
        response = {
            "code": 500,
            "message": error_message,
            "msg": error_message,
            "debug": result.get("debug"),
        }
        await output_manager.send_to_channels(request_body.outputChannels or ["frontend"], response, user_id)
        return JSONResponse(status_code=500, content=response)

    response = {
        "code": 200,
        "data": result["data"],
        "warnings": result["warnings"],
        "debug": result.get("debug"),
    }
    await output_manager.send_to_channels(request_body.outputChannels or ["frontend"], response, user_id)
    return response


@router.post("/save", response_model=StandardResponse, response_model_exclude_none=True)
async def save_persona(
    request_body: PersonaSaveRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    result = service.save_persona(current_user.user_id, request_body.persona)
    if result.get("status") == "failed":
        return JSONResponse(status_code=400, content={"code": 400, "message": result.get("message", "保存失败")})

    return {"code": 200, "data": {"savedPersona": result.get("data"), "record": result.get("record")}}


@router.get("/history", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_persona_history(current_user: AuthenticatedUser = Depends(require_current_user)):
    return {"code": 200, "data": {"personaHistory": service.get_persona_history(current_user.user_id)}}


@router.get("/favorites", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_favorite_personas(current_user: AuthenticatedUser = Depends(require_current_user)):
    return {"code": 200, "data": {"favoritePersonas": service.get_favorite_personas(current_user.user_id)}}


@router.get("/record/{record_id}", response_model=StandardResponse, response_model_exclude_none=True)
async def get_persona_record(record_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    try:
        record = service.get_persona_record(current_user.user_id, record_id)
    except Exception:
        record = {}
    if not record:
        return JSONResponse(status_code=404, content={"code": 404, "message": "人设记录不存在"})
    return {"code": 200, "data": {"record": record}}


@router.delete("/record/{record_id}", response_model=StandardResponse, response_model_exclude_none=True)
async def delete_persona_record(record_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    try:
        deleted = service.delete_persona_record(current_user.user_id, record_id)
    except Exception:
        deleted = False
    if not deleted:
        return JSONResponse(status_code=404, content={"code": 404, "message": "人设记录不存在"})
    return {"code": 200, "data": {"deleted": True, "recordId": record_id}}


@router.post("/favorite", response_model=StandardResponse, response_model_exclude_none=True)
async def set_persona_favorite(
    request_body: PersonaFavoriteRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    try:
        record = service.set_persona_favorite(
            current_user.user_id,
            request_body.recordId,
            request_body.isFavorited,
        )
    except Exception:
        record = {}
    if not record:
        return JSONResponse(status_code=404, content={"code": 404, "message": "人设记录不存在"})
    return {"code": 200, "data": {"record": record}}


@router.post("/follow_up", response_model=StandardResponse, response_model_exclude_none=True)
async def follow_up_persona(
    request_body: PersonaFollowUpRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    follow_up_kwargs = {}
    if request_body.agentDebug:
        follow_up_kwargs["agent_debug"] = request_body.agentDebug.model_dump(exclude_none=True)
    result = await _call_follow_up_service(request_body, current_user, follow_up_kwargs)
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


@router.get("/me", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_persona(current_user: AuthenticatedUser = Depends(require_current_user)):
    return _persona_response(current_user.user_id)


@router.get("/{user_id}", response_model=StandardResponse, response_model_exclude_none=True)
async def get_persona(user_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    return _persona_response(current_user.user_id)


def _persona_response(user_id: str):
    saved_persona = service.get_saved_persona(user_id)
    description = service._format_persona_text(saved_persona)
    return {"code": 200, "data": {"description": description, "persona": saved_persona or None}}
