from __future__ import annotations

from typing import Any

from ...core import get_backend_settings


def build_agent_options(**overrides: Any) -> dict[str, Any]:
    settings = get_backend_settings()
    options: dict[str, Any] = {
        "runtimeProvider": settings.agent_runtime_provider,
        "enableTools": settings.agent_enable_tools,
    }
    for key, value in overrides.items():
        if value is not None:
            options[key] = value
    return options
