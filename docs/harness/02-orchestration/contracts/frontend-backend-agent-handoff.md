# 前端 / 后端 / Agent 交接说明

## 目标

本文档基于当前仓库代码，说明 KOC 项目里前端、后端、Agent 三方的真实交接边界和联调方式。

当前以一期 demo 为主，核心链路仍然是：

- 人设打造
- 热门追踪
- 内容撰写
- 通用聊天

以下能力仍然只是预留：

- `context.plan`
- `analytics.insight`
- `operation.plan`
- `douyin.content_draft`
- `bilibili.content_draft`
- `ContextProviderTool`
- `AgentMemoryTool`

## 职责归属

### 前端负责

- Next.js 页面与交互。
- 收集用户输入。
- 调用后端业务接口。
- 展示后端返回的 `data` 与 `warnings`。
- 对保存成功、删除成功等轻量操作反馈，遵循统一前端实现规范。

前端当前不直接调用 Agent。

相关规范见：

- [frontend-feedback-guidelines.md](../../../../docs/harness/03-implementation/frontend/frontend-feedback-guidelines.md)

### 后端负责

- FastAPI 业务接口。
- 业务数据读写。
- 按业务接口装配 `input` 和 `context`。
- 调用 Agent 服务。
- 将 Agent 结果转换为前端可直接消费的数据结构。
- 决定是否保存 `savePayload`。

后端是用户业务数据的唯一可信源。

### Agent 负责

- 暴露 `/health`、`/agent/tasks`、`/agent/tools`、`/agent/run`。
- 根据 `taskType` 路由 workflow。
- 加载 prompt。
- 调用 mock runtime 或 model runtime。
- 在允许时调用 `RetrievalTool`。
- 返回结构化 `data`、`savePayload`、`sources`、`toolCalls`、`warnings`、`metadata`。

Agent 不直接写后端数据库。

补充口径：

- Agent 应保留工具能力与后续智能调用工具的演进空间
- 后端负责控制当前业务链路是否允许实际执行工具
- 当前一期不要把“默认关闭工具”误写成“Agent 不支持或不应该判断工具使用”

## 当前实际调用链

当前代码中的主链路是：

```text
前端页面
→ 后端业务接口
→ backend/app/adapters/agent/builder.py 装配 context
→ backend/app/adapters/agent/client.py 调用 Agent
→ Agent workflow 返回结构化结果
→ 后端 service 二次整理为前端展示格式
→ 后端决定是否保存业务数据
```

需要特别注意：

- Agent 原生返回 `sources`、`toolCalls`、`metadata`。
- 当前后端业务接口默认不会把这三类字段继续返回给前端。
- 当前前端主要拿到的是后端整理后的 `data` 与 `warnings`。

## 当前 Harness 主线约定

当前 `docs/` 体系已将人设打造、热门追踪、内容撰写统一定义为同一种 harness 对话场景。

统一口径：

- 三个场景本质上都是 AI 多轮对话
- 前端负责输入、展示、结构化渲染和保存动作触发
- 后端负责上下文装配、Agent 调用、结果态判定和结构化结果归一化
- 前端不再承担主要的“是否成品态 / 是否可保存”判断责任

当前正式结果态语义：

- `discussionOnly`
- `structuredResult`

映射到具体场景：

- 人设：`personaDraft`
- 热门：`completeAnalysis`
- 内容：`completeDraft`

当前已确认约定：

- 热门场景采用 `discussionOnly + completeAnalysis`
- `completeAnalysis` 最低完整标准为 `trackName + trends + audience + topics>=1`
- 热门 `completeAnalysis` 应包含 `cardPreview.discoveryKeywords` 和 `cardPreview.shortTopics`，用于初始页历史卡片
- 内容场景采用 `discussionOnly + completeDraft`
- 内容 `completeDraft` 应包含 `cardPreview.keywords`，用于初始页草稿卡片
- 人设场景首轮 `persona.analyze` 必须直接返回结构化初版人设
- 人设场景后续 `persona.follow_up` 默认视为讨论态，只有在需要重新汇总当前人设时才再次输出 `personaDraft`
- 人设 follow-up 如果已经形成完整 `personaDraft`，即使同轮返回 `nextQuestions`，也应视为结构化人设态；`nextQuestions` 表示可选继续完善，不阻断保存
- 热门追踪初始页首条输入必须返回 `discussionOnly = false` 与完整 `completeAnalysis`
- 内容撰写初始页首条输入必须返回 `discussionOnly = false` 与完整 `completeDraft`
- 人设聊天页的保存按钮只允许出现在结构化人设结果下，包括首轮 `persona.analyze` 进入聊天页后的首条结构化结果
- 人设聊天页应展示后端返回的 `nextQuestions`，不能只展示 `reply` 后遗漏问题列表
- 对这两类首条输入，后端应保留用户原始输入用于前端展示，同时把发给 Agent 的业务输入包装成明确的“直接输出完整结果”指令
- 前端聊天页首条 user message 也应直接展示这段包装后的完整指令文案，而不是只展示用户最初输入的简短原文
- 内容 suggestions 作为正式结构返回，不再由前端静态规则生成
- 人设页首轮改为走后端 `persona.analyze`
- 人设保存逻辑需要与结构化结果显式绑定，不能在讨论态消息下暴露保存动作
- 前端不能仅凭存在零散 `personaDraft` 字段显示保存按钮；后端应基于完整 `personaDraft` 标准判定 `discussionOnly / structuredResult`

统一抽象总纲见：

- [harness-overview.md](../../../../docs/harness/01-foundation/harness-overview.md)

## 服务协议

Agent 服务当前实际提供：

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
POST /agent/jobs
GET  /agent/jobs/{job_id}
GET  /prompt-lab
GET  /debug
POST /debug/tavily/test
POST /debug/tavily/search
POST /debug/gemini/prompt-lab
POST /debug/model/prompt-lab
```

其中正式业务协议只有：

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
```

以下只用于保留或调试：

- `POST /agent/jobs`
- `GET /agent/jobs/{job_id}`
- `/prompt-lab`
- `/debug`
- `/debug/*`

## 前端到后端

当前后端真实业务接口如下。

### 通用聊天

```text
POST /api/chat
```

请求体：

```json
{
  "message": "你好",
  "userId": "demo-user",
  "conversationHistory": []
}
```

后端内部调用 Agent `general.chat`。

### 人设模块

```text
POST /api/persona/analyze
POST /api/persona/follow_up
POST /api/persona/save
GET  /api/persona/{user_id}
```

注意：

- 当前代码里实际是 `/follow_up`，不是旧文档里的 `/follow-up`。

### 热门模块

```text
POST   /api/trends/track
POST   /api/trends/save
GET    /api/trends/{user_id}/history
GET    /api/trends/{user_id}/latest
DELETE /api/trends/{user_id}/record
```

注意：

- 当前没有单独暴露 `/api/topics/recommend`。
- `topic.recommend` 任务在 Agent 层存在，但后端尚未提供单独业务路由。

热门追踪聊天页另有一个前端专属请求语义：

- `POST /api/trends/track` 可带 `summaryMode = "realtime_progress"`
- 该语义只允许由热门追踪聊天页触发
- 用于“总结实时进度”按钮和热门追踪消息保存按钮共用的实时总结链路
- 该模式要求前端把当前整段聊天记录放入 `summarySourceConversation`，后端强制把它作为总结素材交给 Agent，返回一版新的完整 `completeAnalysis + cardPreview`
- `summarySourceConversation` 只用于实时总结，不复用普通续聊的 `conversationHistory` 语义
- 该模式不是通用聊天能力，不应迁移到 `/api/chat`

### 内容模块

```text
POST   /api/content/draft
POST   /api/content/save
GET    /api/content/{user_id}/history
DELETE /api/content/{user_id}/record
```

注意：

- 当前没有单独暴露 `/api/content/revise`。
- 内容修改走同一个 `POST /api/content/draft` 入口。
- 当请求里带 `currentDraft` 时，后端会改为调用 Agent `content.revise`。

## 后端到 Agent

后端统一调用：

```text
POST /agent/run
```

后端当前通过 `backend/app/adapters/agent/client.py` 发请求。

默认配置：

```text
AGENT_BASE_URL=http://agent:8010
AGENT_USE_MOCK=false
```

这和 Agent 服务目录里本地单独调试端口 `8010` 不同。联调时需要明确：

- 如果本地直接启动 `agent` 服务，通常用 `http://127.0.0.1:8010`
- 如果按当前仓库默认方式通过 Docker Compose 联调，后端在容器内应通过 `http://agent:8010` 访问
- 只有在“后端容器内跑、Agent 宿主机单独跑”的临时调试场景下，才需要另外手工改成宿主机可访问地址

## Agent 请求与返回

后端发给 Agent 的包结构仍然统一：

```json
{
  "requestId": "req_xxx",
  "taskType": "content.draft",
  "platform": "xiaohongshu",
  "userId": "demo-user",
  "input": {},
  "context": {},
  "options": {}
}
```

Agent 原生返回：

```json
{
  "requestId": "req_xxx",
  "taskType": "content.draft",
  "platform": "xiaohongshu",
  "status": "success",
  "data": {},
  "savePayload": {},
  "sources": [],
  "toolCalls": [],
  "warnings": [],
  "error": null,
  "metadata": {}
}
```

但当前后端内部 `backend/app/schemas/agent/protocol.py` 只定义并消费了核心字段：

- `data`
- `savePayload`
- `warnings`
- `error`

当前后端默认不会把下面这些 Agent 原生字段透传给前端：

- `sources`
- `toolCalls`
- `metadata`

如果后续前端需要展示来源或工具调用记录，需要同步扩展后端协议。

## 当前支持的任务类型

Agent 实际支持：

```text
general.chat
persona.analyze
persona.follow_up
trend.track
topic.recommend
content.draft
content.revise
```

当前后端已经接上的是：

```text
general.chat
persona.analyze
persona.follow_up
trend.track
content.draft
content.revise（通过 /api/content/draft 分支进入）
```

当前后端尚未单独暴露业务入口的是：

```text
topic.recommend
```

## 上下文装配

当前上下文由 `backend/app/adapters/agent/builder.py` 负责固定装配。

### `general.chat`

后端传：

```json
{
  "conversationHistory": [],
  "savedPersona": null
}
```

### `persona.analyze`

后端传：

```json
{
  "userId": "demo-user",
  "history": []
}
```

注意：

- 当前真实代码传的是 `history`。
- 旧文档里常写 `personaHistory`，这和当前实现不一致。

### `persona.follow_up`

后端传：

```json
{
  "baseInfo": {},
  "conversationHistory": []
}
```

### `trend.track`

后端传：

```json
{
  "savedPersona": {},
  "trendHistory": [],
  "conversationHistory": []
}
```

注意：

- 当前 builder 不会主动注入 `retrievalResults`。
- 热门追踪是否执行检索，取决于 Agent workflow 和 `options.enableTools`。

热门追踪聊天页实时总结时，前端仍然调用同一个 `trend.track` 入口，但额外传：

```json
{
  "summaryMode": "realtime_progress",
  "summarySourceConversation": []
}
```

该模式下的交接约定：

- 前端必须传当前热门追踪会话的全部可见 `summarySourceConversation`
- 普通 `conversationHistory` 仍只用于最近上下文续聊，默认不超过最近 12 条
- 后端必须把它视为热门追踪专属的阶段性总结请求
- 后端必须把 `summarySourceConversation` 注入 Agent `context.summarySourceConversation`
- 后端必须强制 Agent 产出完整结构化结果，而不是普通讨论态回复
- 前端拿到结果后直接刷新当前热门追踪分析结果和 `cardPreview`

### `content.draft`

后端传：

```json
{
  "savedPersona": {},
  "selectedTopic": {
    "topic": "xxx"
  },
  "writingEntrySource": {
    "sourceType": "hot_tracking",
    "trackId": "track_xxx",
    "trackName": "大学生成长赛道",
    "topicId": "topic_xxx",
    "topicTitle": "大学生第一次考证前，我最想知道的 5 件事"
  },
  "latestTrendSnapshot": {},
  "draftHistory": [],
  "conversationHistory": []
}
```

### `content.revise`

当前没有单独的 `build_content_revise_context()`。

实际做法是：

- 先走 `build_content_draft_context()`
- 再由 `ContentService` 手动补 `context.currentDraft`
- 同时把 `taskType` 改成 `content.revise`

因此当前真实 `context` 可能包含：

```json
{
  "savedPersona": {},
  "selectedTopic": {
    "topic": "xxx"
  },
  "writingEntrySource": {
    "sourceType": "manual_input",
    "inputText": "新手通勤妆教程"
  },
  "latestTrendSnapshot": {},
  "draftHistory": [],
  "conversationHistory": [],
  "currentDraft": {}
}
```

### 页面联动与写作入口来源协议

当前 harness 需要明确区分三类来源：

- `sources`：Agent 检索来源，例如 `web_search`、`mock_retrieval`
- `cardPreview`：卡片快速扫读字段，不是业务来源
- `writingEntrySource` / `draftSource`：草稿来自哪个页面入口的业务来源

当前正式口径：

- 页面跳转时只传当前入口所需的轻量来源信息
- 不在页面联动 payload 中传递 `draftHistory`、`trendHistory`、`conversationHistory`
- 历史字段接口继续保留，但当前默认空数组，不作为跨页面联动依赖
- 如果未来需要历史记录，应由后端按 `userId`、`draftId`、`trendSnapshotId` 等标识查询，不由前端跨页面搬运整包历史状态

推荐字段：

```json
{
  "writingEntrySource": {
    "sourceType": "hot_tracking",
    "trackId": "track_xxx",
    "trackName": "大学生成长赛道",
    "topicId": "topic_xxx",
    "topicTitle": "大学生第一次考证前，我最想知道的 5 件事",
    "inputText": null
  }
}
```

字段说明：

- `sourceType`：`hot_tracking` / `track` / `manual_input`
- `trackId`：赛道 ID，可选
- `trackName`：赛道名，可选
- `topicId`：选题 ID，可选
- `topicTitle`：选题标题，可选
- `inputText`：用户主动输入主题，仅 `manual_input` 时使用

页面联动规则：

- 从热门追踪进入内容撰写：传 `sourceType=hot_tracking`，并尽量带 `trackId`、`trackName`、`topicId`、`topicTitle`
- 从赛道页进入内容撰写：传 `sourceType=track`，并尽量带 `trackId`、`trackName`
- 用户在内容页直接输入主题：传 `sourceType=manual_input`，并带 `inputText`
- 创建草稿后，后端保存时应把 `writingEntrySource` 固化为草稿记录中的 `draftSource`

## 模型与 Prompt 归属

当前 Agent 的 prompt 加载关系是：

- `persona.analyze` / `persona.follow_up` → `prompts/persona.prompt.md`
- `trend.track` / `topic.recommend` → `prompts/trend-tracking.prompt.md`
- `content.draft` / `content.revise` → `prompts/xhs-content-writing.prompt.md`
- `general.chat` → `prompts/general-chat.prompt.md`

运行时规则：

- `options.runtimeProvider = "mock"`：走 mock runtime
- `options.runtimeProvider = "model"`：走内置模型 runtime
- `options.runtimeProvider = "gemini"`：强制走 GeminiRuntime

默认环境变量为：

```text
AGENT_RUNTIME_MODE=mock
MODEL_API_KEY=
MODEL_BASE_URL=
MODEL_NAME=
```

当前代码里已经没有旧版的 DeepSeek runtime 文件。

## 联网搜索与工具归属

Agent 当前有统一 `RetrievalTool` 抽象。

可识别 source：

- `web_search`
- `mock_retrieval`
- `browser_search`，预留
- `xhs_fetcher`，预留
- `builtin_trend_store`，预留
- `official_rule_store`，预留

当前 `web_search` 的真实 provider 支持：

- `tavily`
- `gemini`
- `gemini_grounding`
- `google`

当前 `ToolRegistry.search_with_fallback()` 的逻辑是：

```text
先尝试 web_search
失败后如果允许 mock fallback，则再尝试 mock_retrieval
```

但要特别注意当前后端业务主链路的真实配置：

- `PersonaService` 调 Agent 时 `enableTools = false`
- `TrendService` 调 Agent 时 `enableTools = false`
- `ContentService` 调 Agent 时 `enableTools = false`

这意味着：

- Agent workflow 本身支持工具调用
- 当前后端主业务入口默认并不会触发真实 `web_search`
- Prompt Lab 与 Agent 独立调试时可以单独验证搜索链路

需要统一理解为：

- 当前是正式业务策略默认关闭工具
- 不是删除工具能力
- 后续更合理的方向是 Agent 在对话中自主判断是否需要工具，而后端只控制开关与权限

## 工具开关策略

当前前后端交接时，应把工具能力和工具策略分开描述：

### 工具能力

Agent 侧继续保留：

- `RetrievalTool` 协议
- `web_search` / `mock_retrieval`
- reserved source 扩展位
- 后续演进为更智能 tool use 的空间

### 工具策略

后端当前通过 `options.enableTools` 控制是否允许实际调用工具：

- `enableTools = false`
  - 本次请求不执行工具
- `enableTools = true`
  - 本次请求允许 workflow 进入工具链路

当前正式业务口径：

- 后端主链路默认 `enableTools = false`
- 调试与实验链路可以单独开启
- 未来即使开启，也应尽量由 Agent 判断是否需要调用，而不是长期靠后端硬编码“这一轮必须查 / 不准查”

## 保存规则

Agent 不直接保存业务数据。

后端当前有两种保存方式：

- 显式调用保存接口，例如 `/api/persona/save`、`/api/trends/save`、`/api/content/save`
- 在 `PersonaService.analyze()` 中直接消费 `response.savePayload` 并落库

其中人设模块当前已经做了自动保存：

- `PersonaService.analyze()` 会调用 `_persist_persona_save_payload()`

趋势和内容模块当前主要还是由业务保存接口负责落库。

对于内容草稿，还应统一保留草稿来源字段：

- 保存草稿时，后端应保存 `draftSource`
- `draftSource` 来源于页面联动阶段的 `writingEntrySource`
- 草稿来源用于草稿箱展示、筛选和回溯，不等同于 Agent 检索 `sources`

## 前端展示建议

当前前端/后端联调时，默认应该围绕后端整理后的字段展示，不是直接按 Agent 原始包展示。

后端当前典型返回模式：

- 人设：直接返回 `response.data`
- 热门：返回 `discussionOnly`、`completeAnalysis`、`text`、`raw`
- 内容：返回 `discussionOnly`、`completeDraft`、`draft`、`suggestions`、`text`、`raw`
- 聊天：只返回 `reply`

卡片预览字段口径：

- 热门历史卡片使用 `completeAnalysis.cardPreview.discoveryKeywords` 和 `completeAnalysis.cardPreview.shortTopics`
- 内容草稿卡片使用 `completeDraft.cardPreview.keywords`
- 这些字段由 Agent 在完整结构化结果同次输出
- 后端只负责归一化、保存和透传，不应额外调用模型二次提炼
- 前端不应把长摘要、正文、`trends`、`audience`、`intro`、`hook` 或 `body` 截断后当作卡片摘要
- 缺少 `cardPreview` 的旧数据可以做短语级兜底，但兜底不是新结果主路径

另外内容草稿的开头字段当前存在兼容差异：

- mock 示例里常见 `hook`
- 模型 schema 中也可能出现 `intro`
- 当前前端内容页会兼容读取 `intro` 或 `hook`

联调时不应仅因这两个字段名不同就判定接口失败。

## Mock 策略

当前仓库里仍保留两层 mock。

### 后端侧 mock Agent

通过：

```text
AGENT_USE_MOCK=true
```

后端会直接读取：

```text
examples/agent-responses/{taskType}.success.json
```

### Agent 侧 mock runtime / mock retrieval

Agent 服务内部：

- 无模型 key 时可走 mock runtime
- 检索失败时可回退 `mock_retrieval`

这两层 mock 可以独立存在，不要混为一谈。

## 交接验收清单

当前代码口径下，最低联调标准应改为：

- `GET /health` 可调用
- `GET /agent/tasks` 可调用
- `GET /agent/tools` 可调用
- `POST /agent/run` 可调用
- `POST /api/chat` 能跑通 `general.chat`
- `POST /api/persona/analyze` 能返回结构化人设
- `POST /api/persona/follow_up` 能继续人设对话
- `POST /api/trends/track` 能返回后端整理后的趋势结果
- `POST /api/content/draft` 能同时覆盖草稿生成和草稿修改两条后端链路
- `savePayload` 能被后端解析
- `requestId` 能贯穿后端和 Agent 日志
- 页面联动阶段能稳定传递 `writingEntrySource`
- 草稿保存后能稳定保留 `draftSource`

## 当前决策总结

- 当前主对接文档以 `docs/` 为准，不再以 `docs.local-backup-*` 为准。
- 前端不直接调用 Agent。
- 后端统一通过 `POST /agent/run` 调 Agent。
- `topic.recommend` 在 Agent 层存在，但后端暂未单独暴露业务接口。
- `content.revise` 当前通过 `POST /api/content/draft` 分支进入。
- Agent 原生支持 `sources`、`toolCalls`、`metadata`，但当前后端默认不透传给前端。
- Agent workflow 支持工具检索，但当前后端主链路默认把 `enableTools` 设为 `false`。
- 正确方向是：保留 Agent 智能调用工具的能力，当前通过开关控制是否允许实际执行工具，正式业务默认关闭。
