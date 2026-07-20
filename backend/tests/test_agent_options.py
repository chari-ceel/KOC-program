import os

from backend.app.adapters.agent.options import build_agent_options
from backend.app.core.config import get_backend_settings


def test_agent_options_default_to_tools_enabled(monkeypatch) -> None:
    monkeypatch.delenv("AGENT_ENABLE_TOOLS", raising=False)
    monkeypatch.delenv("AGENT_RUNTIME_PROVIDER", raising=False)
    get_backend_settings.cache_clear()

    options = build_agent_options()

    assert options["runtimeProvider"] == "model"
    assert options["enableTools"] is True
    assert options["debugAgentTrace"] is False


def test_agent_options_can_be_enabled_via_env(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_ENABLE_TOOLS", "true")
    monkeypatch.setenv("AGENT_RUNTIME_PROVIDER", "gemini")
    get_backend_settings.cache_clear()

    options = build_agent_options(promptOverride="test prompt")

    assert options["runtimeProvider"] == "gemini"
    assert options["enableTools"] is True
    assert options["debugAgentTrace"] is False
    assert options["promptOverride"] == "test prompt"

    monkeypatch.delenv("AGENT_ENABLE_TOOLS", raising=False)
    monkeypatch.delenv("AGENT_RUNTIME_PROVIDER", raising=False)
    get_backend_settings.cache_clear()
