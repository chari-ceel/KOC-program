from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from app.api.routes import router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="KOC Agent Service",
        version=settings.version,
    )
    app.include_router(router)

    def _prompt_lab_file() -> FileResponse:
        return FileResponse(Path(__file__).resolve().parent / "static" / "prompt-lab.html")

    @app.get("/prompt-lab", include_in_schema=False)
    def prompt_lab_page() -> FileResponse:
        return _prompt_lab_file()

    @app.get("/debug", include_in_schema=False)
    def debug_page() -> FileResponse:
        return _prompt_lab_file()

    return app


app = create_app()
