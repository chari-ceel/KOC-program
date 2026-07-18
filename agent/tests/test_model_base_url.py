from app.runtime.gemini_runtime import GeminiRuntime


def test_volcengine_ark_base_url_uses_api_v3_chat_completions() -> None:
    runtime = GeminiRuntime.__new__(GeminiRuntime)

    assert (
        runtime._chat_completions_url("https://ark.cn-beijing.volces.com/api/v3")
        == "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
    )


def test_openai_style_base_url_still_uses_v1_chat_completions() -> None:
    runtime = GeminiRuntime.__new__(GeminiRuntime)

    assert runtime._chat_completions_url("https://api.example.com/v1") == "https://api.example.com/v1/chat/completions"
