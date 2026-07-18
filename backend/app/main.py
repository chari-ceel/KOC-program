import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError
from .endpoints.web.auth import router as auth_router
from .endpoints.web.analytics import router as analytics_router
from .endpoints.web.persona import router as persona_router
from .endpoints.web.trends import router as trends_router
from .endpoints.web.content import router as content_router
from .endpoints.web.chat import router as chat_router
from .endpoints.web.debug import router as debug_router
from .database import client

app = FastAPI(title="KOC Agent Backend")


def _load_allowed_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ALLOW_ORIGINS",
        ",".join(
            [
                "http://localhost:3000",
                "http://localhost:5000",
                "http://localhost:8081",
                "http://localhost:8928",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:5000",
                "http://127.0.0.1:8081",
                "http://127.0.0.1:8928",
            ]
        ),
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_load_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(persona_router)
app.include_router(trends_router)
app.include_router(content_router)
app.include_router(chat_router)
app.include_router(debug_router)
app.include_router(auth_router)
app.include_router(analytics_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401:
        return JSONResponse(status_code=401, content={"code": 401, "message": str(exc.detail or "未登录")})
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/api/health")
async def health_check():
    try:
        client.admin.command("ping")
        db_status = "connected"
    except PyMongoError:
        db_status = "disconnected"
    return {"status": "ok", "db": db_status}
