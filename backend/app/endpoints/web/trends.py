from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from ...schemas.requests import TrendTrackRequest, TrendSaveRequest
from ...schemas.responses import StandardResponse
from ...services.trend import TrendService
from ...adapters.outputs import output_manager
from ...services.auth import AuthenticatedUser, require_current_user
from typing import Dict, Any

router = APIRouter(prefix="/api/trends", tags=["trends"])
service = TrendService()


async def _call_track_service(request_body: TrendTrackRequest, current_user: AuthenticatedUser, track_kwargs: dict):
    if request_body.conversationScopeId:
        try:
            return await service.track(
                current_user.user_id,
                request_body.preference,
                persona=request_body.persona,
                conversation_history=request_body.conversationHistory,
                summary_source_conversation=request_body.summarySourceConversation,
                summary_mode=request_body.summaryMode,
                conversation_scope_id=request_body.conversationScopeId,
                prompt_override=request_body.promptOverride,
                **track_kwargs,
            )
        except TypeError:
            pass

    return await service.track(
        current_user.user_id,
        request_body.preference,
        persona=request_body.persona,
        conversation_history=request_body.conversationHistory,
        summary_source_conversation=request_body.summarySourceConversation,
        summary_mode=request_body.summaryMode,
        prompt_override=request_body.promptOverride,
        **track_kwargs,
    )


@router.post("/track", response_model=StandardResponse, response_model_exclude_none=True)
async def track_trends(
    request_body: TrendTrackRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    track_kwargs = {}
    if request_body.agentDebug:
        track_kwargs["agent_debug"] = request_body.agentDebug.model_dump(exclude_none=True)
    result = await _call_track_service(request_body, current_user, track_kwargs)
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
async def save_trend_record(
    request_body: TrendSaveRequest,
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    try:
        result = service.save_trend_record(current_user.user_id, request_body.record)
    except ValueError as error:
        return JSONResponse(status_code=400, content={"code": 400, "message": str(error)})
    response = {"code": 200, "data": result["data"]}
    return response


@router.get("/history", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_trend_history(current_user: AuthenticatedUser = Depends(require_current_user)):
    return await _trend_history_response(current_user.user_id)


@router.get("/{user_id}/history", response_model=StandardResponse, response_model_exclude_none=True)
async def get_trend_history(user_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    return await _trend_history_response(current_user.user_id)


async def _trend_history_response(user_id: str):
    history = await service.get_trend_history(user_id)
    return {"code": 200, "data": {"trendHistory": history}}


@router.get("/latest", response_model=StandardResponse, response_model_exclude_none=True)
async def get_my_latest_trend_snapshot(current_user: AuthenticatedUser = Depends(require_current_user)):
    return await _latest_trend_response(current_user.user_id)


@router.get("/{user_id}/latest", response_model=StandardResponse, response_model_exclude_none=True)
async def get_latest_trend_snapshot(user_id: str, current_user: AuthenticatedUser = Depends(require_current_user)):
    return await _latest_trend_response(current_user.user_id)


async def _latest_trend_response(user_id: str):
    snapshot = await service.get_latest_snapshot(user_id)
    return {"code": 200, "data": {"latestTrendSnapshot": snapshot}}


@router.delete("/record", response_model=StandardResponse, response_model_exclude_none=True)
async def delete_my_trend_record(
    record: Dict[str, Any],
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    return _delete_trend_response(current_user.user_id, record)


@router.delete("/{user_id}/record", response_model=StandardResponse, response_model_exclude_none=True)
async def delete_trend_record(
    user_id: str,
    record: Dict[str, Any],
    current_user: AuthenticatedUser = Depends(require_current_user),
):
    return _delete_trend_response(current_user.user_id, record)


def _delete_trend_response(user_id: str, record: Dict[str, Any]):
    result = service.delete_trend_record(user_id, record)
    if result["status"] == "failed":
        if result.get("reason") == "invalid":
            return JSONResponse(status_code=400, content={"code": 400, "message": "Invalid trend record"})
        return JSONResponse(status_code=404, content={"code": 404, "message": "Record not found"})
    return {"code": 200, "data": result["data"]}
