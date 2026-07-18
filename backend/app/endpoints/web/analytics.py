from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError

from ...schemas.requests import AnalyticsEventRequest
from ...schemas.responses import StandardResponse
from ...services.analytics import analytics_service
from ...services.auth import AuthenticatedUser, get_current_user


router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.post("/events", response_model=StandardResponse, response_model_exclude_none=True)
async def create_analytics_event(
    request_body: AnalyticsEventRequest,
    request: Request,
    current_user: AuthenticatedUser | None = Depends(get_current_user),
):
    try:
        analytics_service.record_event(
            event_name=request_body.eventName,
            module=request_body.module,
            payload=request_body.to_storage_payload(),
            request=request,
            user=current_user,
        )
    except PyMongoError:
        return JSONResponse(status_code=503, content={"code": 503, "message": "analytics unavailable"})

    return {"code": 200, "data": {"accepted": True}}
