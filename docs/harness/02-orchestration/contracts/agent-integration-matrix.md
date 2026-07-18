# Agent 接口对接矩阵

## 目标

本文档基于当前仓库代码，帮助前端、后端、Agent 三方快速确认：

- 前端实际调用哪个后端接口
- 后端实际对应哪个 Agent `taskType`
- 后端会装配哪些 `context`
- 后端当前会不会继续透传 Agent 原始字段
- 哪些能力是 Agent 已支持、但后端还没暴露

## 总体调用链路

```text
前端
→ 后端业务接口
→ ContextBuilder 装配上下文
→ AgentClient 调用 POST /agent/run
→ Agent workflow 返回结构化结果
→ 后端 service 二次整理
→ 后端保存或转发
```

## 当前一期模块对接矩阵

| 模块 | 前端 / 调用方入口 | 后端业务接口 | Agent `taskType` | 后端发给 Agent 的核心 `input` | 后端发给 Agent 的核心 `context` | 后端回前端的主要结构 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 通用聊天 | 聊天弹窗或调试入口 | `POST /api/chat` | `general.chat` | `userMessage` | `conversationHistory`, `savedPersona` | `{ reply }` | 已接通 |
| 人设分析 | 提交基础信息 | `POST /api/persona/analyze` | `persona.analyze` | `baseInfo` | `userId`, `history` | `response.data` 原样 | 已接通 |
| 人设追问 | 人设对话继续回答 | `POST /api/persona/follow_up` | `persona.follow_up` | `userMessage` | `baseInfo`, `conversationHistory` | `response.data` 原样 | 已接通 |
| 热门追踪 | 输入偏好后生成趋势 | `POST /api/trends/track` | `trend.track` | `userPreference` | `savedPersona`, `trendHistory`, `conversationHistory` | `{ discussionOnly, completeAnalysis, text, raw }` | 已接通 |
| 选题推荐 | 无单独前端入口 | 无单独后端业务接口 | `topic.recommend` | 取决于后续实现 | 取决于后续实现 | 暂无 | Agent 已支持，后端未单独接 |
| 内容草稿 | 生成图文草稿 | `POST /api/content/draft` | `content.draft` | `topic`, `userInstruction` | `savedPersona`, `selectedTopic`, `latestTrendSnapshot`, `draftHistory`, `conversationHistory` | `{ discussionOnly, completeDraft, draft, suggestions, text, raw }` | 已接通 |
| 内容修改 | 在草稿页继续修改 | `POST /api/content/draft` | `content.revise` | `topic`, `userInstruction`, `currentDraft`, `revisionInstruction` | 在草稿上下文基础上额外补 `currentDraft` | `{ discussionOnly, completeDraft, draft, suggestions, text, raw }` | 已接通，但复用草稿接口 |

## Tool 接入矩阵

这里需要把“具备工具能力”和“当前正式业务是否打开工具”分开理解。

### Agent task 维度

| Agent `taskType` | Agent workflow 是否已接入工具链路 | 当前默认是否会实际执行工具 | 说明 |
| --- | --- | --- | --- |
| `general.chat` | 否 | 否 | 当前通用聊天没有正式工具调用链路 |
| `persona.analyze` | 是 | 否 | Agent 已支持统一检索请求；后端默认 `enableTools = false` |
| `persona.follow_up` | 否 | 否 | 当前以已有 `baseInfo + conversationHistory` 为主 |
| `trend.track` | 是 | 否 | Agent 已支持统一检索与 fallback；后端默认关闭 |
| `topic.recommend` | 否 | 否 | 当前 Agent 已实现任务，但未接正式工具链路 |
| `content.draft` | 是 | 否 | Agent 已支持统一检索请求；后端默认关闭 |
| `content.revise` | 否 | 否 | 当前以 `currentDraft + revisionInstruction` 为主 |

### 当前统一口径

- 当前已正式接入工具链路的主任务是：
  - `persona.analyze`
  - `trend.track`
  - `content.draft`
- 当前还没有接入正式工具链路的任务是：
  - `general.chat`
  - `persona.follow_up`
  - `topic.recommend`
  - `content.revise`

这应视为“一期当前实现范围”，不是长期设计上对这些任务永久禁用工具。

更合理的目标方向是：

- 所有对话任务都保留后续按需智能调用工具的能力
- 当前正式业务策略仍可默认关闭工具

## `enableTools` 开关矩阵

当前后端主业务 service 在构造 `AgentRunRequest` 时，都会显式关闭工具：

| 后端 service | 任务 | 当前 `enableTools` | 位置 |
| --- | --- | --- | --- |
| `PersonaService.analyze()` | `persona.analyze` | `false` | `backend/app/services/persona/service.py` |
| `PersonaService.follow_up()` | `persona.follow_up` | `false` | `backend/app/services/persona/service.py` |
| `TrendService.track()` | `trend.track` | `false` | `backend/app/services/trend/service.py` |
| `ContentService.draft()` | `content.draft` / `content.revise` | `false` | `backend/app/services/content/service.py` |

这意味着当前正式业务口径非常明确：

- Agent 工具能力继续保留
- 后端通过 `options.enableTools` 控制当前请求是否允许实际执行工具
- 当前主业务链路默认关闭工具

## 工具能力与产品策略

当前应统一这样理解：

### 能力层

Agent 侧继续保留：

- `RetrievalTool` 协议
- `web_search`
- `mock_retrieval`
- reserved source 扩展位
- 后续演进为更智能 tool use 的空间

### 策略层

当前正式业务策略是：

- 默认 `enableTools = false`
- 不主动在正式用户链路中执行工具
- 调试、Prompt 实验或未来灰度链路可以单独打开

因此“当前默认关闭工具”不应被理解为：

- Agent 不支持工具
- 架构不允许智能使用工具
- 未来这些 task 不应该根据对话内容调用工具

## Agent 支持但后端未单独暴露的能力

| 能力 | Agent 状态 | 后端状态 | 说明 |
| --- | --- | --- | --- |
| `topic.recommend` | 已支持 | 未单独暴露 | 目前没有 `/api/topics/recommend` |
| `POST /agent/jobs` | 已暴露 reserved stub | 未进入业务主链路 | 仅返回 `RESERVED_FEATURE` |
| `GET /agent/jobs/{job_id}` | 已暴露 reserved stub | 未进入业务主链路 | 仅返回 `RESERVED_FEATURE` |
| `sources` 透传前端 | Agent 已返回 | 后端未透传 | 后端当前只消费核心字段 |
| `toolCalls` 透传前端 | Agent 已返回 | 后端未透传 | 同上 |
| `metadata` 透传前端 | Agent 已返回 | 后端未透传 | 同上 |

## 后端上下文装配规则

当前统一由 [builder.py](../../../../backend/app/adapters/agent/builder.py) 装配。

### `general.chat`

```json
{
  "conversationHistory": [],
  "savedPersona": null
}
```

### `persona.analyze`

```json
{
  "userId": "demo-user",
  "history": []
}
```

注意：

- 当前真实字段是 `history`
- 不是旧文档常写的 `personaHistory`

### `persona.follow_up`

```json
{
  "baseInfo": {},
  "conversationHistory": []
}
```

### `trend.track`

```json
{
  "savedPersona": {},
  "trendHistory": [],
  "conversationHistory": []
}
```

### `content.draft`

```json
{
  "savedPersona": {},
  "selectedTopic": {
    "topic": "xxx"
  },
  "latestTrendSnapshot": {},
  "draftHistory": [],
  "conversationHistory": []
}
```

### `content.revise`

当前没有独立 builder 方法，后端实际是在草稿上下文基础上手动补：

```json
{
  "currentDraft": {}
}
```

所以最终常见上下文为：

```json
{
  "savedPersona": {},
  "selectedTopic": {
    "topic": "xxx"
  },
  "latestTrendSnapshot": {},
  "draftHistory": [],
  "conversationHistory": [],
  "currentDraft": {}
}
```

## 后端调用 Agent 时的实际 `options`

当前后端默认都显式传：

```json
{
  "runtimeProvider": "model",
  "enableTools": false
}
```

并按模块附加：

- `promptOverride`
- `forceStructuredReport`
- `forceFullDraft`

这意味着当前真实联调现状是：

- Agent workflow 支持检索
- 但后端主业务链路默认不会触发真实 `web_search`

正确理解应补充为：

- 当前是策略默认关闭
- 不是架构不支持工具
- 未来目标仍应是让 Agent 在对话过程中自主判断是否需要工具，而后端只负责是否放开开关

## 保存建议矩阵

| Agent `savePayload.type` | Agent / mock 常见 `suggestedCollection` | 后端当前处理现状 | 说明 |
| --- | --- | --- | --- |
| `general_chat_turn` | `agent_conversations` | 未见统一持久化 | 聊天接口当前只回 `reply` |
| `persona_result` | `persona_results` | `PersonaService.analyze()` 会自动消费 `savePayload` 保存 | 当前唯一已自动落库的主链路 |
| `persona_conversation_turn` | `persona_conversations` | 未见统一自动保存 | 如需落库需补后端逻辑 |
| `trend_tracking_result` | `trend_tracking_results` | 主要通过 `/api/trends/save` 保存 | 当前后端不会自动保存 Agent 返回 |
| `topic_recommendation` | `topic_recommendations` | 后端未接单独业务链 | 仅 Agent mock 层可见 |
| `content_draft` | `content_drafts` | 主要通过 `/api/content/save` 保存 | 当前后端不会自动保存 Agent 返回 |
| `content_revision` | mock 里常见 `content_revisions`；runtime 默认可能归并到 `content_drafts` | 当前无统一自动保存逻辑 | 文档与代码存在命名差异，需以业务逻辑为准 |

## 错误联调场景

### 缺少上下文

可使用：

```text
examples/agent-responses/failed.missing_context.json
```

典型场景：

- 未保存人设直接进入 `trend.track`
- 未提供 `currentDraft` 却走 `content.revise`

### 工具不可用

可使用：

```text
examples/agent-responses/partial_success.tool_unavailable.json
```

但要注意当前后端主链路默认 `enableTools = false`，因此业务联调时未必自然触发这类场景。要验证这条链路，通常需要：

- 直接调 Agent `/agent/run`
- 或修改后端传给 Agent 的 `options.enableTools`

## 前端展示建议

当前代码口径下，前端联调更应关注后端整理后的结果，而不是 Agent 原始包。

### 聊天

前端只需要读取：

```json
{
  "reply": "..."
}
```

### 人设

前端读取：

- `data`
- `warnings`

### 热门

前端读取：

- `data.structured`
- `data.text`
- `data.raw`
- `warnings`

### 内容

前端读取：

- `data.draft`
- `data.text`
- `data.raw`
- `warnings`

### 字段兼容提醒

内容草稿里当前开头字段可能是：

- `hook`
- `intro`

前端当前已经做兼容读取，不应据此判断 Agent 接口异常。

## 推荐联调顺序

### 第一步：确认 Agent 活着

```text
GET /health
GET /agent/tasks
GET /agent/tools
```

### 第二步：确认后端业务路由

优先联调：

```text
POST /api/chat
POST /api/persona/analyze
POST /api/persona/follow_up
POST /api/trends/track
POST /api/content/draft
```

### 第三步：验证后端 mock Agent 模式

启用：

```text
AGENT_USE_MOCK=true
```

让后端直接读取：

```text
examples/agent-responses/*.json
```

### 第四步：切换真实 Agent 服务

关闭：

```text
AGENT_USE_MOCK=false
```

并确认 `AGENT_BASE_URL` 指向可访问的 Agent 服务地址。

## 当前决策总结

- 对接矩阵应以当前 `docs/harness/` 和代码为准，不再以旧备份文档为准。
- 默认 Docker Compose 联调时，后端应通过 `AGENT_BASE_URL=http://agent:8010` 调用 Agent；本地单独联调时通常使用 `http://127.0.0.1:8010`。
- 后端当前没有单独暴露 `/api/topics/recommend` 和 `/api/content/revise`。
- 内容修改通过 `POST /api/content/draft` 分支进入 `content.revise`。
- Agent 已支持 `sources`、`toolCalls`、`metadata`，但后端默认不透传给前端。
- Agent workflow 支持检索，但后端默认把 `enableTools` 设为 `false`。
- 当前正确方向是：保留 Agent 智能调用工具的能力，用开关控制当前是否允许实际执行工具，正式业务默认关闭。
