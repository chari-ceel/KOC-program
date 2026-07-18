from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/debug", tags=["debug"])

PROMPT_FILES = {
    "persona": {
        "taskType": "persona.follow_up",
        "fileName": "persona.prompt.md",
    },
    "trending": {
        "taskType": "trend.track",
        "fileName": "trend-tracking.prompt.md",
    },
    "content": {
        "taskType": "content.draft",
        "fileName": "xhs-content-writing.prompt.md",
    },
}


@router.get("/prompts")
async def get_debug_prompts():
    prompt_dir = Path(__file__).resolve().parents[4] / "prompts"
    prompts = {}

    for module_id, config in PROMPT_FILES.items():
        prompt_path = prompt_dir / config["fileName"]
        try:
            content = prompt_path.read_text(encoding="utf-8")
        except OSError as exc:
            return JSONResponse(
                status_code=500,
                content={
                    "code": 500,
                    "message": f"读取 Prompt 文件失败：{prompt_path.name}",
                    "detail": str(exc),
                },
            )

        prompts[module_id] = {
            "taskType": config["taskType"],
            "fileName": config["fileName"],
            "content": content,
        }

    return {"code": 200, "data": {"prompts": prompts}}
