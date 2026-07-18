# KOC Agent 服务

这是 KOC Agent 的独立服务目录。当前阶段已实现 FastAPI 服务壳、统一 `/agent/run` 入口、task router、mock runtime、workflow stub、`web_search` adapter 和 `mock_retrieval` fallback。

Agent 不接前端、不连接后端数据库、不保存业务数据。后端通过 `POST /agent/run` 调用 Agent，并负责装配 `context` 和保存 `savePayload`。

## 默认启动方式

KOC 项目默认应从仓库根目录用 Docker Compose 启动整套服务，而不是单独手动启动 Agent：

```powershell
docker compose -f docker-compose.full.yml up --build -d
```

在这个默认方案里：

- `agent` 运行在 compose 内部网络
- 默认不直接暴露到宿主机
- 应由 `backend` 通过 `http://agent:8010` 调用

标准联调入口：

- 前端：`http://127.0.0.1:5000`
- 后端健康检查：`http://127.0.0.1:5001/api/health`
- Nginx 聚合入口：`http://127.0.0.1:8928`

## 本地单独调试 Agent

只有在需要单独调试 Agent 服务本身时，才使用下面这种本地启动方式：

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

## 基础接口

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:8010/health"
Invoke-RestMethod -Method Get -Uri "http://localhost:8010/agent/tasks"
Invoke-RestMethod -Method Get -Uri "http://localhost:8010/agent/tools"
```

如果本机代理导致 `localhost` 请求返回 `502 Bad Gateway`，先设置：

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
$env:no_proxy = "127.0.0.1,localhost"
```

## Agent 调用

```powershell
$body = Get-Content -Raw -LiteralPath "..\examples\agent-requests\content.draft.request.json"
Invoke-RestMethod -Method Post -Uri "http://localhost:8010/agent/run" -ContentType "application/json" -Body $body
```

一期支持：

```text
general.chat
persona.analyze
persona.follow_up
trend.track
topic.recommend
content.draft
content.revise
```

`trend.track` 会优先走 `web_search`。如果没有配置 provider 或 API key，会返回结构化工具调用记录，并回退到 `mock_retrieval`。

## 配置

复制 `.env.example` 为本地 `.env` 后按需填写。不要提交真实 `.env` 或 API key。

```text
AGENT_RUNTIME_MODE=mock
ENABLE_WEB_SEARCH=true
WEB_SEARCH_PROVIDER=
WEB_SEARCH_API_KEY=
WEB_SEARCH_TIMEOUT_MS=8000
MODEL_API_KEY=
MODEL_BASE_URL=https://api.openai-proxy.org/google/v1beta
MODEL_NAME=gemini-2.5-flash
ENABLE_DEBUG_AUTH=true
```

## 调试页面

启动服务后打开：

```text
http://127.0.0.1:8010/prompt-lab
```

页面会临时接收 Anthropic、GLM、Gemini、Qwen 和 Tavily Key，用同一份 Prompt 做多模型对比。Key 只保存在当前页面内存里，不会写入 `toolCalls` 或 `metadata`。

本地调试接口：

```text
POST /debug/tavily/test
POST /debug/tavily/search
POST /debug/gemini/prompt-lab
POST /debug/model/prompt-lab
```

这些接口只用于 Prompt Lab 和本地验证，不属于后端正式业务协议。

## 测试

```powershell
pytest
```

默认测试不依赖真实联网搜索。无 provider/API key 时，`web_search` fallback 链路也会被测试覆盖。
