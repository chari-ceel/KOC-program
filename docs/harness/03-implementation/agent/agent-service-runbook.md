# Agent 独立服务运行说明

## 目标

本文档基于当前 `agent/`、`backend/` 代码，说明 KOC Agent 独立服务如何启动、如何调试、如何与后端联调，以及当前哪些行为是正式协议，哪些只是本地调试能力。

## 服务定位

当前 Agent 服务是一个可单独运行的 FastAPI 服务。

主调用链：

```text
前端
→ 后端业务接口
→ 后端 Agent Adapter
→ KOC Agent 服务
→ runtime / tools / prompts
→ KOC Agent 服务返回结构化结果
→ 后端保存或转发
```

Agent 不直接连接前端，不直接写业务数据库。

## 当前技术栈

当前实现使用：

```text
Python 3.11+
FastAPI
Pydantic
Uvicorn
httpx
```

## 默认启动方式

KOC harness 的默认联调方式不是单独本地启动 Agent，而是从仓库根目录启动整套 Docker Compose：

```powershell
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d
```

在默认运行方式下：

- `agent` 在 compose 网络内监听 `8010`
- `backend` 通过 `http://agent:8010` 调用它
- 开发者默认通过 `http://127.0.0.1:5000` 或 `http://127.0.0.1:8928` 验证业务链路

## 本地单独启动 Agent

只有在需要隔离调试 Agent 服务时，才使用下面这种本地启动方式：

以 `agent/` 目录为工作目录：

```powershell
cd agent
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
uvicorn app.main:app --host 127.0.0.1 --port 8010
```

单独启动后默认访问地址：

```text
http://127.0.0.1:8010
```

## 环境变量

当前 `.env.example` 中的主要变量如下：

```text
AGENT_PORT=8010
AGENT_RUNTIME_MODE=mock
ENABLE_DEBUG_AUTH=true
ENABLE_WEB_SEARCH=true
WEB_SEARCH_PROVIDER=
WEB_SEARCH_API_KEY=
WEB_SEARCH_TIMEOUT_MS=8000
MODEL_API_KEY=
MODEL_BASE_URL=
MODEL_NAME=
```

说明：

- `AGENT_RUNTIME_MODE=mock`：默认走 mock runtime
- `AGENT_RUNTIME_MODE=model`：默认走 model runtime
- 当前代码已不再使用旧版 `DEEPSEEK_*` 环境变量
- 当前 runtime 会兼容读取 `GOOGLE_API_KEY` / `GOOGLE_BASE_URL` / `GOOGLE_MODEL`

## 正式业务接口

当前 Agent 服务正式业务接口为：

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
```

### `GET /health`

测试命令：

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8010/health"
```

预期返回：

```json
{
  "status": "ok",
  "service": "koc-agent",
  "version": "0.1.0"
}
```

### `GET /agent/tasks`

测试命令：

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8010/agent/tasks"
```

当前预期包含：

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `topic.recommend`
- `content.draft`
- `content.revise`

### `GET /agent/tools`

测试命令：

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8010/agent/tools"
```

当前重点关注：

- `retrieval` 是否存在
- `web_search` 状态是 `available` 还是 `needs_config`
- `mock_retrieval` 是否为 `available`

### `POST /agent/run`

测试命令：

```powershell
$body = Get-Content -Raw -LiteralPath "..\\examples\\agent-requests\\content.draft.request.json"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8010/agent/run" -ContentType "application/json" -Body $body
```

## 保留接口

当前还暴露了以下保留接口：

```text
POST /agent/jobs
GET  /agent/jobs/{job_id}
```

说明：

- 当前只返回 `status = "reserved"`
- 不进入真实异步队列
- 用于让前后端提前确认接口形态存在

测试命令：

```powershell
$body = @'
{
  "requestId": "job_req_001",
  "taskType": "content.draft",
  "platform": "xiaohongshu",
  "userId": "demo-user",
  "input": {},
  "context": {},
  "options": {}
}
'@
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8010/agent/jobs" -ContentType "application/json" -Body $body
```

## Prompt Lab 与调试接口

当前本地调试入口：

```text
GET /prompt-lab
GET /debug
```

两者当前实际打开的是同一个页面。

调试接口：

```text
POST /debug/tavily/test
POST /debug/tavily/search
POST /debug/gemini/prompt-lab
POST /debug/model/prompt-lab
```

这些接口只用于：

- Prompt 实验
- provider 连接测试
- Tavily / Gemini Grounding 验证
- 多模型对比

它们不是后端正式业务协议的一部分。

## runtime 行为

当前 workflow 基类会按以下顺序选择 runtime：

- `options.runtimeProvider = "gemini"`：优先走 `GeminiRuntime`
- `options.runtimeProvider = "model"`：优先走默认 model runtime
- `options.runtimeProvider = "mock"`：走 mock runtime
- 否则回退到 `AGENT_RUNTIME_MODE`

当前默认 model runtime 的启用前提是：

```text
MODEL_API_KEY 或 GOOGLE_API_KEY 已配置
```

如果没有配置模型 key：

- workflow 会返回 `MODEL_PROVIDER_UNAVAILABLE`
- 默认提示配置 `GOOGLE_API_KEY` 或 `MODEL_API_KEY`

## Prompt 加载

当前 prompt 映射如下：

- `persona.analyze` / `persona.follow_up` → `prompts/persona.prompt.md`
- `trend.track` / `topic.recommend` → `prompts/trend-tracking.prompt.md`
- `content.draft` / `content.revise` → `prompts/xhs-content-writing.prompt.md`
- `general.chat` → `prompts/general-chat.prompt.md`

如果请求里传了：

```json
{
  "options": {
    "promptOverride": "..."
  }
}
```

则会优先使用覆盖后的 prompt。

## 检索工具与搜索链路

当前统一通过 `ToolRegistry` 管理检索 source。

可识别 source：

- `web_search`
- `mock_retrieval`
- `browser_search`，预留
- `xhs_fetcher`，预留
- `builtin_trend_store`，预留
- `official_rule_store`，预留

### `web_search` 当前 provider

当前 `WebSearchTool` 支持：

- `tavily`
- `gemini`
- `gemini_grounding`
- `google`

### fallback 逻辑

当 source 为 `web_search` 且失败时：

- 若 `allowMockFallback != false`，会继续尝试 `mock_retrieval`
- 若 `requireRealWebResearch = true`，则 workflow 会在真实检索失败后直接返回失败

## 重要现状：后端主链路默认关闭工具

虽然 Agent workflow 已支持工具调用，但当前后端 service 实际发给 Agent 的 `options` 基本都是：

```json
{
  "runtimeProvider": "model",
  "enableTools": false
}
```

这意味着：

- Agent 服务独立调试时可以验证检索链路
- 当前前后端主业务联调默认不会走真实 `web_search`

如果要验证检索链路，建议直接调 Agent `/agent/run`，并显式传：

```json
{
  "options": {
    "runtimeProvider": "model",
    "enableTools": true
  }
}
```

## mock response 使用方式

当前有两层 mock，要区分清楚。

### 1. Agent 服务内部 mock runtime

当：

- `AGENT_RUNTIME_MODE=mock`
- 或请求显式传 `runtimeProvider = "mock"`

Agent 会走内部 mock runtime，返回按 `taskType` 匹配的 mock 响应。

常用 mock 文件位于：

```text
examples/agent-responses/
```

例如：

- `general.chat.success.json`
- `persona.analyze.success.json`
- `persona.follow_up.success.json`
- `trend.track.success.json`
- `topic.recommend.success.json`
- `content.draft.success.json`
- `content.revise.success.json`

### 2. 后端侧 mock AgentClient

当后端环境变量：

```text
AGENT_USE_MOCK=true
```

后端不会真正请求 Agent 服务，而是直接从：

```text
examples/agent-responses/{taskType}.success.json
```

读取结果。

这两层 mock 是独立的，不要混淆。

## mock tool result 使用方式

工具相关 mock 位于：

```text
examples/tool-results/
```

当前常见文件：

- `retrieval.xhs_trends.success.json`
- `retrieval.empty.json`
- `retrieval.tool_unavailable.json`

主要用于：

- 验证检索成功时的来源结构
- 验证检索失败时的降级行为

## 当前建议测试顺序

### 第一步：只启动 Agent

验证：

```text
GET /health
GET /agent/tasks
GET /agent/tools
```

### 第二步：跑一个最小 `/agent/run`

优先选：

- `general.chat`
- `persona.analyze`
- `content.draft`

### 第三步：验证 Prompt Lab

打开：

```text
http://127.0.0.1:8010/prompt-lab
```

或：

```text
http://127.0.0.1:8010/debug
```

### 第四步：验证检索链路

直接调用 Agent `/agent/run`，并设置：

```json
{
  "options": {
    "runtimeProvider": "model",
    "enableTools": true,
    "requireRealWebResearch": false
  }
}
```

### 第五步：再接后端业务服务

确认后端 `AGENT_BASE_URL` 指向正确地址。

## 后端联调时的地址说明

当前仓库里有两个常见 Agent 地址来源：

### Agent 服务本地示例

```text
http://127.0.0.1:8010
```

### Docker Compose 联调地址

```text
http://agent:8010
```

这两者不一致，联调时必须明确当前运行方式：

- 如果 Agent 与后端都在宿主机本地进程里跑，通常建议把后端 `AGENT_BASE_URL` 指到 `http://127.0.0.1:8010`
- 如果按当前仓库默认方式走 Docker Compose 联调，后端应通过 `http://agent:8010` 访问 Agent

## 代理问题

如果本机代理影响本地回环访问，可能出现 `502 Bad Gateway`。可先设置：

```powershell
$env:NO_PROXY = "127.0.0.1,localhost"
$env:no_proxy = "127.0.0.1,localhost"
```

## 日志建议

Agent 服务日志建议至少记录：

- `requestId`
- `taskType`
- `platform`
- `status`
- `durationMs`
- `error.code`

若开启工具链，还建议记录：

- `toolCalls`
- `researchSource` / `retrievalSource`

不建议在日志中记录完整密钥和敏感用户原文。

## Docker 预留

当前仓库中已有：

- `agent/Dockerfile`

但主工程联调默认仍应先以仓库根目录 Docker Compose 为准，而不是本地分别直跑服务。

## 验收标准

在当前代码口径下，Agent 独立服务联调通过的最低标准应是：

- 能独立启动 Agent 服务
- `GET /health`、`GET /agent/tasks`、`GET /agent/tools` 可调用
- `POST /agent/run` 能对 7 个正式任务返回结构化结果
- `POST /agent/jobs`、`GET /agent/jobs/{job_id}` 明确返回 `reserved`
- `/prompt-lab` 与 `/debug` 可打开调试页
- 模型 key 未配置时，能返回结构化失败而不是崩溃
- 工具不可用时，能返回标准化工具失败或 fallback 结果

## 当前决策总结

- Agent 服务目录的本地默认端口是 `8010`
- Docker Compose 联调时，后端应通过 `http://agent:8010` 调用 Agent；本地单独联调时通常使用 `http://127.0.0.1:8010`
- 正式业务接口以 `/health`、`/agent/tasks`、`/agent/tools`、`/agent/run` 为准
- `/debug`、`/prompt-lab` 和 `/debug/*` 只用于本地调试
- 当前模型配置统一使用 `MODEL_*`
- 当前后端主链路默认把 `enableTools` 设为 `false`
