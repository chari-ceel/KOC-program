import httpx
from fastapi import APIRouter

from app.core.config import get_settings
from app.core.errors import RESERVED_FEATURE
from app.router.task_router import RESERVED_TASKS, SUPPORTED_TASKS, TaskRouter
from app.schemas.agent import AgentRunRequest
from app.schemas.debug import (
    GeminiPromptLabRequest,
    ModelPromptLabRequest,
    TavilyDebugRequest,
    TavilySearchRequest,
)
from app.schemas.jobs import AgentJobCreateRequest
from app.tools.registry import ToolRegistry


router = APIRouter()
task_router = TaskRouter()


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.service_name,
        "version": settings.version,
    }


@router.get("/agent/tasks")
def agent_tasks() -> dict:
    return {
        "tasks": SUPPORTED_TASKS,
        "reservedTasks": RESERVED_TASKS,
    }


@router.get("/agent/tools")
def agent_tools() -> dict:
    settings = get_settings()
    retrieval_doctor = ToolRegistry(settings).doctor()

    return {
        "tools": [
            retrieval_doctor,
            {
                "toolType": "context_provider",
                "status": "reserved",
            },
            {
                "toolType": "agent_memory",
                "status": "partial",
            },
        ]
    }


@router.post("/agent/run")
def agent_run(request: AgentRunRequest) -> dict:
    response = task_router.route(request)
    return response.model_dump(by_alias=True)


@router.post("/debug/tavily/test", include_in_schema=False)
def debug_tavily_test(request: TavilyDebugRequest) -> dict:
    api_key = request.api_key.strip()
    if not api_key:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {
                "code": "MISSING_API_KEY",
                "message": "请先输入 Tavily API Key。",
            },
        }

    payload = {
        "query": request.query,
        "max_results": 1,
        "include_answer": False,
        "include_raw_content": False,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            json=payload,
            headers=headers,
            timeout=8,
        )
    except httpx.TimeoutException:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "TIMEOUT", "message": "Tavily API 请求超时。"},
        }
    except httpx.HTTPError as exc:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "NETWORK_ERROR", "message": str(exc)},
        }

    try:
        data = response.json()
    except ValueError:
        data = {"rawText": response.text[:500]}

    if response.status_code >= 400:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "error": {
                "code": "TAVILY_HTTP_ERROR",
                "message": _extract_tavily_error(data),
            },
            "providerResponse": data,
        }

    results = data.get("results", [])
    return {
        "status": "success",
        "httpStatus": response.status_code,
        "resultCount": len(results),
        "firstResult": results[0] if results else None,
    }


@router.post("/debug/tavily/search", include_in_schema=False)
def debug_tavily_search(request: TavilySearchRequest) -> dict:
    api_key = request.api_key.strip()
    if not api_key:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {
                "code": "MISSING_API_KEY",
                "message": "请先输入 Tavily API Key。",
            },
        }

    payload = {
        "query": request.query,
        "max_results": max(1, min(request.max_results, 10)),
        "include_answer": request.include_answer,
        "include_raw_content": False,
    }
    try:
        response = httpx.post(
            "https://api.tavily.com/search",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
    except httpx.TimeoutException:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "TIMEOUT", "message": "Tavily API 请求超时。"},
        }
    except httpx.HTTPError as exc:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "NETWORK_ERROR", "message": str(exc)},
        }

    try:
        data = response.json()
    except ValueError:
        data = {"rawText": response.text[:1200]}

    if response.status_code >= 400:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "error": {
                "code": "TAVILY_HTTP_ERROR",
                "message": _extract_tavily_error(data),
            },
            "providerResponse": data,
        }

    results = data.get("results", [])
    normalized_results = []
    for index, result in enumerate(results, start=1):
        if not isinstance(result, dict):
            continue
        normalized_results.append(
            {
                "index": index,
                "title": result.get("title") or result.get("url") or f"Result {index}",
                "url": result.get("url") or "",
                "content": result.get("content") or "",
                "score": result.get("score"),
            }
        )

    sources = [
        {"title": item["title"], "url": item["url"]}
        for item in normalized_results
        if item.get("url")
    ]
    return {
        "status": "success",
        "httpStatus": response.status_code,
        "query": request.query,
        "answer": data.get("answer") or "",
        "results": normalized_results,
        "sources": sources,
    }


@router.post("/debug/gemini/prompt-lab", include_in_schema=False)
def debug_gemini_prompt_lab(request: GeminiPromptLabRequest) -> dict:
    return _run_gemini_prompt_lab(
        api_key=request.api_key,
        base_url=request.base_url,
        model=request.model,
        system_prompt=request.system_prompt,
        user_prompt=request.user_prompt,
        temperature=request.temperature,
        response_format=request.response_format,
        enable_google_search=request.enable_google_search,
        require_google_search=request.require_google_search,
    )


def _run_gemini_prompt_lab(
    api_key: str,
    base_url: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    response_format: str,
    enable_google_search: bool,
    require_google_search: bool,
) -> dict:
    api_key = api_key.strip()
    if not api_key:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "MISSING_API_KEY", "message": "请先输入 Gemini API Key。"},
        }

    base_url = base_url.strip().rstrip("/") or "https://api.openai-proxy.org/google/v1beta"
    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
        },
    }
    if response_format == "json":
        payload["generationConfig"]["responseMimeType"] = "application/json"
    if enable_google_search:
        payload["tools"] = [{"google_search": {}}]

    try:
        response = httpx.post(
            f"{base_url}/models/{model}:generateContent",
            json=payload,
            headers={"x-goog-api-key": api_key},
            timeout=45,
        )
    except httpx.TimeoutException:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "TIMEOUT", "message": "Gemini API 请求超时。"},
        }
    except httpx.HTTPError as exc:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "NETWORK_ERROR", "message": str(exc)},
        }

    try:
        data = response.json()
    except ValueError:
        data = {"rawText": response.text[:1200]}

    if response.status_code >= 400:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "error": {
                "code": "GEMINI_HTTP_ERROR",
                "message": _extract_tavily_error(data),
            },
            "providerResponse": data,
        }

    output_parts = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [])
    )
    output_text = "\n".join(
        part.get("text", "") for part in output_parts if isinstance(part.get("text"), str)
    )
    sources = _extract_gemini_sources(data)
    if enable_google_search and require_google_search and not sources:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "outputText": output_text,
            "sources": [],
            "usage": data.get("usageMetadata", {}),
            "model": model,
            "error": {
                "code": "GOOGLE_SEARCH_GROUNDING_MISSING",
                "message": "已要求 Gemini 使用 Google Search Grounding，但响应中没有返回可验证来源。",
            },
        }
    return {
        "status": "success",
        "httpStatus": response.status_code,
        "outputText": output_text,
        "sources": sources,
        "usage": data.get("usageMetadata", {}),
        "model": model,
        "provider": "gemini",
    }


@router.post("/debug/model/prompt-lab", include_in_schema=False)
def debug_model_prompt_lab(request: ModelPromptLabRequest) -> dict:
    provider = request.provider.strip().lower()
    if provider == "gemini":
        return _run_gemini_prompt_lab(
            api_key=request.api_key,
            base_url=request.base_url,
            model=request.model,
            system_prompt=request.system_prompt,
            user_prompt=request.user_prompt,
            temperature=request.temperature,
            response_format=request.response_format,
            enable_google_search=request.enable_google_search,
            require_google_search=request.require_google_search,
        )
    if provider in {"anthropic", "claude"}:
        return _run_anthropic_prompt_lab(request)
    if provider in {"glm", "zhipu"}:
        return _run_chat_completions_prompt_lab(request, "GLM", "https://open.bigmodel.cn/api/paas/v4")
    if provider in {"qwen", "dashscope"}:
        return _run_chat_completions_prompt_lab(request, "Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    return {
        "status": "failed",
        "httpStatus": None,
        "error": {
            "code": "UNSUPPORTED_PROVIDER",
            "message": f"暂不支持的模型供应商：{request.provider}",
        },
    }


def _run_chat_completions_prompt_lab(
    request: ModelPromptLabRequest,
    provider_name: str,
    default_base_url: str,
) -> dict:
    api_key = request.api_key.strip()
    if not api_key:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "MISSING_API_KEY", "message": f"请先输入 {provider_name} API Key。"},
        }

    base_url = request.base_url.strip().rstrip("/") or default_base_url
    payload = {
        "model": request.model,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": request.user_prompt},
        ],
        "temperature": request.temperature,
    }
    if request.response_format == "json":
        payload["response_format"] = {"type": "json_object"}

    try:
        response = httpx.post(
            f"{base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=45,
        )
    except httpx.TimeoutException:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "TIMEOUT", "message": f"{provider_name} API 请求超时。"},
        }
    except httpx.HTTPError as exc:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "NETWORK_ERROR", "message": str(exc)},
        }

    try:
        data = response.json()
    except ValueError:
        data = {"rawText": response.text[:1200]}

    if response.status_code >= 400:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "error": {
                "code": f"{provider_name.upper()}_HTTP_ERROR",
                "message": _extract_tavily_error(data),
            },
            "providerResponse": data,
        }

    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {
        "status": "success",
        "httpStatus": response.status_code,
        "outputText": content,
        "usage": data.get("usage", {}),
        "model": data.get("model", request.model),
        "provider": provider_name.lower(),
    }


def _run_anthropic_prompt_lab(request: ModelPromptLabRequest) -> dict:
    api_key = request.api_key.strip()
    if not api_key:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "MISSING_API_KEY", "message": "请先输入 Anthropic API Key。"},
        }

    base_url = _normalize_anthropic_base_url(request.base_url)
    payload = {
        "model": request.model,
        "system": request.system_prompt,
        "messages": [{"role": "user", "content": request.user_prompt}],
        "temperature": request.temperature,
        "max_tokens": 4096,
    }

    try:
        response = httpx.post(
            f"{base_url}/messages",
            json=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            timeout=45,
        )
    except httpx.TimeoutException:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "TIMEOUT", "message": "Anthropic API 请求超时。"},
        }
    except httpx.HTTPError as exc:
        return {
            "status": "failed",
            "httpStatus": None,
            "error": {"code": "NETWORK_ERROR", "message": str(exc)},
        }

    try:
        data = response.json()
    except ValueError:
        data = {"rawText": response.text[:1200]}

    if response.status_code >= 400:
        return {
            "status": "failed",
            "httpStatus": response.status_code,
            "error": {
                "code": "ANTHROPIC_HTTP_ERROR",
                "message": _extract_tavily_error(data),
            },
            "providerResponse": data,
        }

    output_text = "\n".join(
        item.get("text", "")
        for item in data.get("content", [])
        if item.get("type") == "text" and isinstance(item.get("text"), str)
    )
    if request.response_format == "json":
        output_text = output_text.strip()
    return {
        "status": "success",
        "httpStatus": response.status_code,
        "outputText": output_text,
        "usage": data.get("usage", {}),
        "model": data.get("model", request.model),
        "provider": "anthropic",
    }


def _extract_gemini_sources(data: dict) -> list[dict]:
    chunks = (
        data.get("candidates", [{}])[0]
        .get("groundingMetadata", {})
        .get("groundingChunks", [])
    )
    sources = []
    seen = set()
    for chunk in chunks:
        web = chunk.get("web") if isinstance(chunk, dict) else None
        if not isinstance(web, dict):
            continue
        uri = web.get("uri")
        if not isinstance(uri, str) or uri in seen:
            continue
        seen.add(uri)
        sources.append(
            {
                "title": web.get("title") or uri,
                "url": uri,
            }
        )
    return sources


def _normalize_anthropic_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/") or "https://api.openai-proxy.org/anthropic"
    if normalized.endswith("/anthropic"):
        return f"{normalized}/v1"
    return normalized


@router.post("/agent/jobs")
def create_agent_job(request: AgentJobCreateRequest) -> dict:
    return {
        "status": "reserved",
        "jobId": None,
        "error": {
            "code": RESERVED_FEATURE,
            "message": "Async Agent jobs are reserved for a later phase.",
            "details": {
                "taskType": request.taskType,
                "platform": request.platform,
            },
        },
        "metadata": {"syncEndpoint": "/agent/run"},
    }


def _extract_tavily_error(data: dict) -> str:
    for key in ("detail", "error", "message"):
        value = data.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            nested_message = value.get("message")
            if isinstance(nested_message, str):
                return nested_message
    raw_text = data.get("rawText")
    if isinstance(raw_text, str) and raw_text.strip():
        return raw_text.strip()[:500]
    return "API 返回错误，但响应中没有可读错误信息。"


@router.get("/agent/jobs/{job_id}")
def get_agent_job(job_id: str) -> dict:
    return {
        "status": "reserved",
        "jobId": job_id,
        "error": {
            "code": RESERVED_FEATURE,
            "message": "Async Agent jobs are reserved for a later phase.",
            "details": {"jobId": job_id},
        },
        "metadata": {"syncEndpoint": "/agent/run"},
    }
