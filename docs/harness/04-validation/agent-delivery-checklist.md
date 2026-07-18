# Agent 交付清单

## 目标

本文档用于按当前一期口径，说明 KOC Agent 模块已经交付了什么、当前服务器 git 仓库里已经有什么、哪些仍然只是预留，以及联调前后应该检查什么。

这里的重点不是“理想上要交付什么”，而是：

- 当前一期已经落到代码里的内容
- 当前已经进入服务器 git 的内容
- 当前还没有做完、但已经被文档或代码登记的内容

## 当前一期必须交付的核心资产

### 一期对接文档

当前已经整理并进入仓库的核心对接文档包括：

- `docs/harness/02-orchestration/contracts/frontend-backend-agent-handoff.md`
- `docs/harness/02-orchestration/contracts/agent-api-contract.md`
- `docs/harness/03-implementation/agent/agent-context-plan.md`
- `docs/harness/02-orchestration/contracts/agent-integration-matrix.md`
- `docs/harness/03-implementation/agent/tool-contract.md`
- `docs/harness/03-implementation/agent/web-search-contract.md`
- `docs/harness/03-implementation/agent/agent-service-runbook.md`
- `docs/harness/01-foundation/agent-architecture.md`
- `docs/harness/03-implementation/backend/data-storage.md`

用途：

- 让前端知道当前页面到底接了哪些后端接口
- 让后端知道如何装配上下文、如何调用 Agent、如何保存
- 让 Agent 开发知道当前一期真实边界

### 一期 workflow 文档

当前仓库中已有：

- `docs/harness/02-orchestration/scenarios/persona-workflow.md`
- `docs/harness/02-orchestration/scenarios/trend-tracking-workflow.md`
- `docs/harness/02-orchestration/scenarios/content-writing-workflow.md`

用途：

- 描述每个任务的输入、上下文、处理流程、输出和降级规则

### Prompt 资产

当前仓库中已有：

- `prompts/persona.prompt.md`
- `prompts/trend-tracking.prompt.md`
- `prompts/xhs-content-writing.prompt.md`
- `prompts/general-chat.prompt.md`

用途：

- 作为当前一期 prompt 资源
- 被 `PromptLoader` 实际加载

### mock 与样例文件

当前仓库中已有：

- `examples/agent-requests/`
- `examples/agent-responses/`
- `examples/tool-results/`

用途：

- 支持 mock 联调
- 支持 Agent 独立调试
- 支持测试与协议核对

## 当前一期已经进入服务器 git 的代码资产

### Agent 服务代码

当前已经进入服务器 git，并且不再只是规划的包括：

- `agent/app/main.py`
- `agent/app/api/routes.py`
- `agent/app/router/task_router.py`
- `agent/app/workflows/`
- `agent/app/runtime/`
- `agent/app/tools/`
- `agent/app/prompts/loader.py`
- `agent/app/responses/mock_response_loader.py`
- `agent/app/schemas/`

### 后端 Agent 对接代码

当前已经进入服务器 git：

- `backend/app/adapters/agent/client.py`
- `backend/app/adapters/agent/builder.py`
- `backend/app/services/persona/service.py`
- `backend/app/services/trend/service.py`
- `backend/app/services/content/service.py`
- `backend/app/endpoints/web/*.py`
- `backend/app/database/crud/*.py`

### 前端联动代码

当前已经进入服务器 git：

- `frontend/context/AppStateContext.tsx`
- `frontend/app/profile/page.tsx`
- `frontend/app/trending/page.tsx`
- `frontend/app/content/page.tsx`
- `frontend/components/ChatDialog.tsx`

### 测试

当前已经进入服务器 git 的一期相关测试包括：

- `agent/tests/test_agent_run_mock.py`
- `agent/tests/test_task_router.py`
- `agent/tests/test_web_search_contract.py`
- `agent/tests/test_mock_retrieval.py`
- `agent/tests/test_reserved_interfaces.py`
- `agent/tests/test_service_shell.py`
- `agent/tests/test_agent_full_flow.py`

这说明当前阶段已经不是“尚未实现 Agent 服务代码”，而是：

- 一期服务骨架和主流程已存在
- 仍有部分能力是 mock、stub 或 reserved

## 当前一期已经完成的能力

### Agent 正式接口

当前已经有：

- `GET /health`
- `GET /agent/tasks`
- `GET /agent/tools`
- `POST /agent/run`

### Agent 保留接口

当前也已有：

- `POST /agent/jobs`
- `GET /agent/jobs/{job_id}`

但它们当前只返回：

- `reserved`
- `RESERVED_FEATURE`

### 当前已支持的 Agent 任务

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `topic.recommend`
- `content.draft`
- `content.revise`

### 当前后端已接出的主任务

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `content.draft`
- `content.revise`

注意：

- `topic.recommend` 在 Agent 层已支持
- 当前后端还没有单独暴露业务入口

### 当前已支持的工具能力

已实现：

- `web_search`
- `mock_retrieval`

已登记但保留：

- `browser_search`
- `xhs_fetcher`
- `builtin_trend_store`
- `official_rule_store`
- `context_provider`
- `agent_memory`

## 当前仍是一期，但尚未完成或未打通的部分

### 仍是预留的能力

- `context.plan`
- `ContextProviderTool`
- `AgentMemoryTool`
- `analytics.insight`
- `operation.plan`
- `douyin.content_draft`
- `bilibili.content_draft`
- 多 Agent
- 长期记忆

### 虽有代码基础但业务主链路未完全打开的能力

- `topic.recommend`：Agent 支持，但后端未单独暴露
- `web_search`：Agent 工具已支持，但当前后端主链路默认 `enableTools=false`
- `sources/toolCalls/metadata`：Agent 原生返回，后端默认不透传给前端
- `trendHistory` 注入：Mongo 中有数据，但 builder 当前未真正注入 Agent

## 当前联调前检查项

### 接口检查

- `GET /health` 可调用
- `GET /agent/tasks` 可调用
- `GET /agent/tools` 可调用
- `POST /agent/run` 可调用
- reserved job 接口返回结构化 `reserved`

### 任务检查

Agent 层必须支持：

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `topic.recommend`
- `content.draft`
- `content.revise`

后端业务层当前必须至少跑通：

- `/api/chat`
- `/api/persona/analyze`
- `/api/persona/follow_up`
- `/api/trends/track`
- `/api/content/draft`

### 保存检查

- Agent 不直接写数据库
- `savePayload` 能被后端解析
- 人设自动保存链路能工作
- 趋势 / 内容的手动保存链路能工作

### 工具检查

- `web_search` 必须继续通过 `RetrievalTool` 接入
- `mock_retrieval` 仍作为一期 fallback
- reserved source 不应伪装成已实现
- 当前后端主链路默认不开工具，这一点联调时要认清

### 文档检查

- 文档必须明确当前仍是一期
- 文档必须区分“已实现”“已登记未启用”“未来阶段”
- 文档不能再写成“Agent 服务代码尚未实现”

## 当前联调完成标准

按当前一期代码状态，联调可以认为完成，当满足：

- Agent 可独立启动
- 后端可访问 `GET /health`
- 后端可读取任务列表和工具列表
- 后端可调用 `POST /agent/run`
- mock 模式和真实服务模式都能跑通主链路
- `persona.analyze` 可返回结构化结果并自动保存
- `trend.track` 可返回后端整理后的趋势结果
- `content.draft` 可返回草稿
- `content.revise` 可通过 `/api/content/draft` 分支调用
- 趋势历史与草稿历史能在前端全局状态初始化时恢复

## 推荐阅读顺序

### 给后端同学

1. `docs/harness/02-orchestration/contracts/agent-api-contract.md`
2. `docs/harness/03-implementation/agent/agent-context-plan.md`
3. `docs/harness/03-implementation/agent/tool-contract.md`
4. `docs/harness/03-implementation/agent/web-search-contract.md`
5. `docs/harness/03-implementation/agent/agent-service-runbook.md`
6. `docs/harness/03-implementation/backend/data-storage.md`

### 给前端同学

1. `docs/harness/02-orchestration/contracts/frontend-backend-agent-handoff.md`
2. `docs/harness/02-orchestration/contracts/agent-integration-matrix.md`
3. `docs/harness/01-foundation/agent-architecture.md`
4. `docs/harness/03-implementation/backend/data-storage.md`
5. `docs/harness/02-orchestration/scenarios/`

### 给 Agent 开发

1. `docs/harness/02-orchestration/contracts/agent-api-contract.md`
2. `docs/harness/03-implementation/agent/tool-contract.md`
3. `docs/harness/03-implementation/agent/web-search-contract.md`
4. `docs/harness/01-foundation/agent-architecture.md`
5. `docs/harness/04-validation/agent-implementation-breakdown.md`
6. `prompts/`

## 当前状态总结

### 已完成

- 一期核心文档体系
- Agent 服务骨架与主要 workflow
- PromptLoader 与 prompts 资产
- mock response 与 mock retrieval
- ToolRegistry 与 web_search / fallback 机制
- 后端 Agent adapter、service、CRUD
- 前端对人设、趋势、内容主链路页面
- 一批覆盖 mock / router / tool 的测试

### 仍待继续完善

- `topic.recommend` 的后端业务出口
- tools 在正式主链路里的开启策略
- `sources/toolCalls/metadata` 前端可见性
- 趋势历史真正注入 Agent
- 一期未实现的 reserved 能力继续保持预留，不提前写成已交付
