from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _read_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class BackendSettings:
    agent_runtime_provider: str = "model"
    agent_enable_tools: bool = False
    memory_model_api_key: str = ""
    memory_model_base_url: str = ""
    memory_model_name: str = ""


@lru_cache
def get_backend_settings() -> BackendSettings:
    runtime_provider = os.getenv("AGENT_RUNTIME_PROVIDER", "model").strip() or "model"
    return BackendSettings(
        agent_runtime_provider=runtime_provider,
        agent_enable_tools=_read_bool("AGENT_ENABLE_TOOLS", False),
        memory_model_api_key=os.getenv("MEMORY_MODEL_API_KEY", "").strip(),
        memory_model_base_url=os.getenv("MEMORY_MODEL_BASE_URL", "https://open.bigmodel.cn/api/paas/v4").strip(),
        memory_model_name=os.getenv("MEMORY_MODEL_NAME", "glm-4.5-flash").strip(),
    )
