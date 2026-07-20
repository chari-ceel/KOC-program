# 模型与搜索配置维护说明

本文只说明配置维护位置和改动原则，不记录任何真实 API Key。

## 配置入口

当前模型与搜索配置应优先通过环境变量维护，不要写死在前端页面里。

| 配置项 | 当前维护位置 | 说明 |
| --- | --- | --- |
| 主 Agent 默认模型 | `agent/app/core/config.py` 的 `MODEL_NAME` / `GOOGLE_MODEL` | 默认值仅用于本地兜底；生产以环境变量和火山方舟控制台当前可用模型为准 |
| 主 Agent 模型 Base URL | `MODEL_BASE_URL` / `GOOGLE_BASE_URL` | 火山方舟或其他 OpenAI-compatible endpoint 都应走环境变量 |
| 主 Agent API Key | `MODEL_API_KEY` / `GOOGLE_API_KEY` | 只放本地 `.env` 或部署环境变量，禁止写进 README、PRD、前端页面和日志 |
| 后端调用 Agent runtime | `backend/app/core/config.py` 的 `AGENT_RUNTIME_PROVIDER` | 默认 `model`，用于决定后端请求 Agent 时的 runtime provider |
| 业务链路是否启用工具 | `backend/app/core/config.py` 的 `AGENT_ENABLE_TOOLS` | 默认关闭；需要真实检索链路时再显式打开 |
| Memory 模型 | `MEMORY_MODEL_NAME` / `MEMORY_MODEL_BASE_URL` / `MEMORY_MODEL_API_KEY` | 用于后端 memory summarization，不应与前端页面耦合 |
| 搜索开关 | `ENABLE_WEB_SEARCH` | Agent 服务级 web search 开关 |
| 搜索 provider | `WEB_SEARCH_PROVIDER` | 当前支持 `tavily`、`gemini`、`gemini_grounding`、`google` |
| 搜索 API Key | `WEB_SEARCH_API_KEY` | 不配置时可在部分 provider 下回退读取 `MODEL_API_KEY`，但仍不应泄露 |
| 搜索超时 | `WEB_SEARCH_TIMEOUT_MS` | 默认 8000ms |
| 最大搜索结果数 | `agent/app/schemas/tools.py` 的 `RetrievalToolRequest.limit` | schema 默认 10；debug 搜索接口会把 `maxResults` 限制在 1-10 |
| 是否展示来源 | Agent 响应中的 `sources` / `toolCalls` | 当前由 Agent workflow 产出；前端页面需要展示时读取响应字段，不要把 provider 策略写死在页面 |

## 推荐模型策略

- 主 Agent 默认模型：以 `MODEL_NAME` 为准。
- 人设打造、热门追踪、内容撰写、图文指导等业务子 Agent：优先沿用主 Agent 模型，只有在质量、成本或速度有明确差异时，再通过后端或 Agent 配置拆分。
- Memory 模型：以 `MEMORY_MODEL_NAME` 为准，适合使用更快、更便宜的总结模型。
- 火山方舟模型列表不要在 PRD 或页面中承诺永久固定，实际可选模型以火山方舟控制台当前可用模型为准。

## 搜索策略

- 搜索能力开关看 `ENABLE_WEB_SEARCH` 和后端 `AGENT_ENABLE_TOOLS`。
- 搜索 provider 看 `WEB_SEARCH_PROVIDER`。
- 搜索超时看 `WEB_SEARCH_TIMEOUT_MS`，任务级请求也可以传 `timeoutMs`。
- 最大结果数由 `RetrievalToolRequest.limit` 控制；如需统一全局上限，后续优先新增环境变量或配置文件字段，不要改前端页面。
- 来源展示应读取 Agent 返回的 `sources` 或 `toolCalls`，并明确告诉用户搜索结果来自公开资料，不代表小红书官方私有热度。

## 安全要求

- README、PRD、截图、日志、issue、PR 描述中都不要展示真实 API Key。
- 调试页面可接收临时 Key，但不能把 Key 持久化到仓库。
- 日志只记录 provider、模型名、请求状态和错误码，不记录完整 Key。
- 更换模型或 provider 时，优先改 `.env`、部署环境变量或后端/Agent 配置，不改前端页面。
