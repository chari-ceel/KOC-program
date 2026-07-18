# Agent 实现拆解计划

## 目标

本文档基于当前仓库现状，说明 KOC Agent 一期代码已经如何落地、现有结构是什么、哪些点已经进入服务器 git、哪些仍是一期内的补强项。

这份文档不再把项目当作“尚未开始实现”，而是把它视为：

- 当前仍然是一阶段
- 但主干代码已经存在
- 现在要做的是继续收敛、补强、对齐，而不是从零设计

## 当前一期实现现状

当前已经存在并进入仓库的实现包括：

- Agent FastAPI 服务入口
- Agent API 路由
- Router / Workflow / Runtime / Tool / PromptLoader
- 后端 Agent adapter 与 ContextBuilder
- 后端业务 service 与 Mongo CRUD
- 前端 profile / trending / content 主页面
- Agent 测试与 mock 样例

因此当前应该把问题定义为：

```text
一期服务骨架和主链路已存在，接下来继续补齐一致性、稳定性和未完全接出的能力
```

## 当前一期实现原则

当前代码实际上已经遵循了这些一期原则：

- Agent 可独立启动
- 后端可通过 HTTP 调 Agent
- `POST /agent/run` 作为统一入口
- 一期主要围绕小红书链路
- Agent 不直接查业务数据库
- Agent 不直接保存业务数据
- mock / tool fallback 保留，适合联调和测试

当前仍需继续坚持：

- 不把二期能力误写成一期已完成
- 不让业务主链路过度依赖尚未稳定的真实搜索
- 不让 Agent 越界承担后端存储责任

## 当前实际目录结构

当前不是“建议结构”，而是已经存在的结构：

```text
agent/
  app/
    main.py
    api/
      routes.py
    core/
      config.py
      errors.py
    schemas/
      agent.py
      tools.py
      common.py
      debug.py
      jobs.py
    router/
      task_router.py
    workflows/
      persona.py
      trend_tracking.py
      content_writing.py
      general_chat.py
      base.py
    prompts/
      loader.py
    runtime/
      base.py
      mock_runtime.py
      gemini_runtime.py
    tools/
      registry.py
      retrieval.py
      web_search.py
      mock_retrieval.py
      context_provider.py
      agent_memory.py
    responses/
      mock_response_loader.py
    static/
      prompt-lab.html
  tests/
    ...
```

说明：

- `context_provider.py`、`agent_memory.py` 目录位已经存在，但当前仍属 reserved
- runtime 当前真实文件名是 `gemini_runtime.py`，不是旧规划里的 `model_runtime.py`
- `general_chat.py` 已独立存在

## 当前已经落地的模块职责

### API 层

文件：

- `agent/app/api/routes.py`
- `agent/app/main.py`

当前负责：

- `GET /health`
- `GET /agent/tasks`
- `GET /agent/tools`
- `POST /agent/run`
- `POST /agent/jobs`
- `GET /agent/jobs/{job_id}`
- `/prompt-lab`
- `/debug`
- `/debug/*`

当前不负责：

- 业务上下文装配
- 真实业务存储

### Schema 层

当前已落地：

- `AgentRunRequest`
- `AgentRunResponse`
- `AgentError`
- `AgentWarning`
- `SavePayload`
- `RetrievalToolRequest`
- `RetrievalToolResult`
- `ToolCall`
- 调试与 jobs schema

当前仍存在的问题：

- 后端镜像 schema 没有完整暴露 Agent 原生返回字段

### Router 层

文件：

- `agent/app/router/task_router.py`

当前负责：

- 校验 `platform`
- 校验 `taskType`
- 将任务分发到：
  - `GeneralChatWorkflow`
  - `PersonaWorkflow`
  - `TrendTrackingWorkflow`
  - `ContentWritingWorkflow`

### Workflow 层

当前已存在：

- `base.py`
- `general_chat.py`
- `persona.py`
- `trend_tracking.py`
- `content_writing.py`

当前已经做到了：

- 校验部分必需 `input`
- 校验部分必需 `context`
- 支持 mock / model runtime
- 支持在 `enableTools=true` 时调用检索工具
- 支持缺少上下文时返回结构化失败

当前仍需补强：

- 更细的 schema 校验
- 更一致的 output 约束
- 一些任务的真实 model schema 完整度

### Prompt 层

当前 `PromptLoader` 已落地，并且直接读取根目录 `prompts/`。

当前特点：

- `taskType -> Markdown prompt` 映射已经固定
- `promptOverride` 已支持
- 当前仍然是“说明型 Markdown 直接作为 runtime prompt”

### Runtime 层

当前已落地：

- `MockRuntime`
- `GeminiRuntime`

当前真实行为：

- `MockRuntime` 返回确定性 mock
- `GeminiRuntime` 实际走 OpenAI-compatible chat completions
- 通过 `MODEL_*` 或兼容 `GOOGLE_*` 读取配置

当前仍需补强：

- 某些任务的 schema 更细化
- JSON 修复与重试策略更严谨

### Tool 层

当前已落地：

- `ToolRegistry`
- `web_search`
- `mock_retrieval`
- `retrieval` 协议辅助

当前保留：

- `context_provider`
- `agent_memory`
- reserved retrieval source

当前真实特点：

- fallback 发生在 `ToolRegistry.search_with_fallback()`
- 当前后端主链路默认不启用工具

### Mock 响应层

当前已落地：

- `MockResponseLoader`
- `examples/agent-responses/*.json`

当前真实行为：

- 会补丁回 `requestId`
- 会补齐 `taskType`
- 会补齐 `platform`
- 会在 `metadata` 中标记 `runtimeMode = mock`

## 当前后端实现拆解

当前后端已拆为：

- `backend/app/adapters/agent/client.py`
- `backend/app/adapters/agent/builder.py`
- `backend/app/services/persona/service.py`
- `backend/app/services/trend/service.py`
- `backend/app/services/content/service.py`
- `backend/app/endpoints/web/*.py`
- `backend/app/database/crud/*.py`

当前后端真实特点：

- 已经不是“待实现 Agent Adapter”
- 当前已有真实 HTTP / mock 双模式调用
- `ContextBuilder` 已经落地，但部分方法仍带 `_mock_` 命名

## 当前前端实现拆解

当前前端已拆为：

- 全局状态：`frontend/context/AppStateContext.tsx`
- 人设页：`frontend/app/profile/page.tsx`
- 趋势页：`frontend/app/trending/page.tsx`
- 内容页：`frontend/app/content/page.tsx`
- 临时聊天：`frontend/components/ChatDialog.tsx`

当前前端真实特点：

- 已能初始化恢复人设、趋势历史、草稿历史
- 页面内还有各自的 sessionStorage 恢复逻辑
- 不是“前端页面尚未存在”的状态

## 当前一期开发阶段应如何理解

当前最准确的阶段判断是：

```text
一期主干代码已存在
一期对接已能跑
仍有部分能力处于 mock / fallback / reserved / 未完全接出状态
```

所以接下来不是“从第 1 步实现服务壳开始”，而是：

1. 维护现有主干结构稳定
2. 补齐当前一期缺口
3. 把旧文档从规划口吻更新为现状口吻

## 当前一期仍需补强的点

### 1. `topic.recommend` 的后端业务出口

现状：

- Agent 已支持
- 后端还没单独暴露

### 2. `content.revise` 的业务路由清晰度

现状：

- 当前复用 `POST /api/content/draft`
- 对联调不够直观

### 3. `sources/toolCalls/metadata` 透传

现状：

- Agent 原生返回
- 后端默认不透传给前端

### 4. 趋势历史真正注入 Agent

现状：

- Mongo 已有历史
- builder 当前仍传空数组

### 5. 工具主链路策略

现状：

- workflow 支持工具
- 后端主链路默认 `enableTools=false`

### 6. 保存策略一致性

现状：

- 人设自动保存
- 趋势与内容手动保存

## 当前不该做的事

在仍然是一期的前提下，当前仍不该做：

- 不让 Agent 直接连业务 Mongo
- 不把 reserved 能力包装成已完成
- 不把真实搜索强绑进每条业务主链路
- 不提前引入复杂多 Agent 编排
- 不把当前文档写成“已进入二期”

## 当前后续替换点

### mock response → 更稳定真实 runtime

当前已支持：

```text
workflow → MockRuntime / GeminiRuntime
```

后续可继续加强：

- schema 校验
- JSON 修复
- retry

### fallback tool → 更稳定正式工具策略

当前已支持：

```text
web_search → fallback mock_retrieval
```

后续可继续完善：

- 哪些任务默认启用工具
- 哪些接口允许强制真实搜索

### 固定上下文 → 更完整上下文

当前已支持：

```text
后端固定装配 context
```

后续仍可扩展到：

- `context.plan`
- `ContextProviderTool`

但这些当前仍不属于一期已完成项。

## 当前推荐关注顺序

如果下一步继续推进一期，我建议优先关注：

1. 后端与 Agent 字段对齐
2. `topic.recommend` 的业务出口
3. 趋势历史注入 Agent
4. 工具开启策略
5. 保存策略一致性

## 当前总结

- 当前实现拆解文档应服务于“继续收敛一期”，而不是“从零开工”
- 主干结构已经进入服务器 git，目录和职责已经基本成型
- 现在最有价值的工作，不是再画一套新结构，而是把现有结构的空档补齐、口径对齐、边界写清
