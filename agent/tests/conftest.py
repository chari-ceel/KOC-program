import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def force_model_runtime_defaults_for_tests(monkeypatch):
    monkeypatch.setenv("AGENT_RUNTIME_MODE", "model")
    monkeypatch.setenv("ENABLE_WEB_SEARCH", "false")
    monkeypatch.setenv("WEB_SEARCH_PROVIDER", "")
    monkeypatch.setenv("WEB_SEARCH_API_KEY", "")
    monkeypatch.setenv("MODEL_API_KEY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
