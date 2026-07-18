from app.workflows.base import BaseWorkflow


def test_model_runtime_does_not_fallback_to_mock_when_model_unavailable(monkeypatch) -> None:
    monkeypatch.setenv("AGENT_RUNTIME_MODE", "model")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    from app.core.config import Settings, get_settings

    monkeypatch.setitem(Settings.model_config, "env_file", None)

    get_settings.cache_clear()
    workflow = BaseWorkflow()

    runtime = workflow._runtime_for_request(
        type(
            "Req",
            (),
            {
                "options": {"runtimeProvider": "model"},
            },
        )(),
    )

    assert runtime is None
