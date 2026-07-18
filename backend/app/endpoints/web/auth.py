from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ...services.auth import (
    SESSION_COOKIE_NAME,
    SESSION_TTL_DAYS,
    AuthenticatedUser,
    auth_service,
    get_current_user,
    require_current_user,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthCredentialRequest(BaseModel):
    username: str
    password: str
    name: str | None = None
    avatar: str | None = None


class AuthProfileRequest(BaseModel):
    name: str | None = None
    avatar: str | None = None


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


@router.post("/register")
async def register(request_body: AuthCredentialRequest, response: Response):
    try:
        user = auth_service.register(
            request_body.username,
            request_body.password,
            request_body.name or "",
            request_body.avatar or "",
        )
        session_id = auth_service.create_session_for_user(user)
    except ValueError as error:
        return JSONResponse(status_code=400, content={"code": 400, "message": str(error)})
    _set_session_cookie(response, session_id)
    return {"code": 200, "data": {"user": user}}


@router.post("/login")
async def login(request_body: AuthCredentialRequest, response: Response):
    try:
        user, session_id = auth_service.login(request_body.username, request_body.password)
    except ValueError as error:
        return JSONResponse(status_code=401, content={"code": 401, "message": str(error)})

    _set_session_cookie(response, session_id)
    return {"code": 200, "data": {"user": user}}


@router.post("/logout")
async def logout(request: Request, response: Response):
    auth_service.logout(request.cookies.get(SESSION_COOKIE_NAME))
    _clear_session_cookie(response)
    return {"code": 200, "data": {"loggedOut": True}}


@router.get("/me")
async def me(user: AuthenticatedUser | None = Depends(get_current_user)):
    if user is None:
        return JSONResponse(status_code=401, content={"code": 401, "message": "未登录"})
    return {
        "code": 200,
        "data": {
            "user": {
                "userId": user.user_id,
                "username": user.username,
                "name": user.name,
                "avatar": user.avatar,
            }
        },
    }


@router.patch("/profile")
async def update_profile(
    request_body: AuthProfileRequest,
    user: AuthenticatedUser = Depends(require_current_user),
):
    try:
        updated_user = auth_service.update_profile(user.user_id, request_body.name, request_body.avatar)
    except ValueError as error:
        return JSONResponse(status_code=400, content={"code": 400, "message": str(error)})
    return {"code": 200, "data": {"user": updated_user}}


@router.delete("/me")
async def delete_me(
    request: Request,
    response: Response,
    user: AuthenticatedUser = Depends(require_current_user),
):
    deleted = auth_service.delete_user(user.user_id)
    auth_service.logout(request.cookies.get(SESSION_COOKIE_NAME))
    _clear_session_cookie(response)
    return {"code": 200, "data": {"deleted": deleted}}
