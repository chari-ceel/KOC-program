# KOC Agent API 协议

## 目标

本文档基于当前 `agent/` 与 `backend/` 代码，定义后端调用 KOC Agent 独立服务时应遵循的实际接口协议。

本文档关注的是：

- Agent 对后端暴露的接口
- 每个 `taskType` 的请求和返回结构
- 当前代码里已经实现的字段与保留字段

## 服务边界

Agent 当前负责：

- 接收统一 `POST /agent/run` 请求
- 校验 `platform` 和 `taskType`
- 根据 `taskType` 进入 workflow
- 加载对应 prompt
- 调用 mock runtime 或 model runtime
- 在允许时调用统一检索工具
- 返回结构化结果

这里需要补充一个关键口径：

- Agent 应保留“按需智能调用工具”的能力
- 当前是否允许实际执行工具，由请求策略控制
- 一期当前默认关闭工具，不代表接口层放弃该能力

Agent 当前不负责：

- 前端页面
- 后端业务 API
- 用户登录
- 业务数据库落库
- 业务数据权限控制

## 接口清单

当前 Agent 服务实际暴露：

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
POST /agent/jobs
GET  /agent/jobs/{job_id}
```

以及本地调试接口：

```text
GET  /prompt-lab
GET  /debug
POST /debug/tavily/test
POST /debug/tavily/search
POST /debug/gemini/prompt-lab
POST /debug/model/prompt-lab
```

正式业务协议只应依赖：

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
```

## `GET /health`

返回 Agent 服务自身状态。

返回示例：

```json
{
  "status": "ok",
  "service": "koc-agent",
  "version": "0.1.0"
}
```

## `GET /agent/tasks`

返回当前支持任务与保留任务。

当前实际返回包含：

```json
{
  "tasks": [
    "general.chat",
    "persona.analyze",
    "persona.follow_up",
    "trend.track",
    "topic.recommend",
    "content.draft",
    "content.revise"
  ],
  "reservedTasks": [
    "context.plan",
    "analytics.insight",
    "operation.plan",
    "douyin.content_draft",
    "bilibili.content_draft"
  ]
}
```

## `GET /agent/tools`

返回当前 Agent 可识别的工具类型与 source 状态。

当前 `retrieval` 组会返回：

- `web_search`
- `mock_retrieval`
- `browser_search`，预留
- `xhs_fetcher`，预留
- `builtin_trend_store`，预留
- `official_rule_store`，预留

返回示例：

```json
{
  "tools": [
    {
      "toolType": "retrieval",
      "status": "partial",
      "sources": [
        {
          "source": "web_search",
          "status": "needs_config",
          "role": "primary"
        },
        {
          "source": "mock_retrieval",
          "status": "available",
          "role": "fallback"
        },
        {
          "source": "browser_search",
          "status": "reserved",
          "role": "reserved"
        }
      ]
    },
    {
      "toolType": "context_provider",
      "status": "reserved"
    },
    {
      "toolType": "agent_memory",
      "status": "reserved"
    }
  ]
}
```

说明：

- `web_search.status = "available"` 的前提是同时满足 `ENABLE_WEB_SEARCH=true`、`WEB_SEARCH_PROVIDER` 已配置、`WEB_SEARCH_API_KEY` 已配置。
- 如果缺少 provider 或 key，则状态会是 `needs_config`。

## `POST /agent/run`

这是后端调用 Agent 的唯一正式业务入口。

所有任务都通过该接口进入，由 `taskType` 区分具体 workflow。

### 请求结构

```json
{
  "requestId": "req_20260518_0001",
  "taskType": "content.draft",
  "platform": "xiaohongshu",
  "userId": "demo-user",
  "input": {},
  "context": {},
  "options": {}
}
```

字段定义：

| 字段 | 是否必填 | 说明 |
| --- | --- | --- |
| `requestId` | 否，建议传 | 用于联调、日志和追踪 |
| `taskType` | 是 | Agent 任务类型 |
| `platform` | 是 | 当前只支持 `xiaohongshu` |
| `userId` | 是 | 用户 ID |
| `input` | 是 | 当前任务的直接输入 |
| `context` | 是 | 后端装配的上下文 |
| `options` | 否 | runtime、工具、调试等附加配置 |

### 平台约束

当前实际只支持：

```text
xiaohongshu
```

如果传入其他平台，返回：

- `status = "failed"`
- `error.code = "UNSUPPORTED_PLATFORM"`

### 运行时配置

当前有效的运行时环境变量为：

```text
AGENT_RUNTIME_MODE=mock|model
MODEL_API_KEY=
MODEL_BASE_URL=
MODEL_NAME=
ENABLE_DEBUG_AUTH=true|false
```

需要特别说明：

- 当前代码已不再使用旧版 `DEEPSEEK_*` 环境变量
- `GeminiRuntime` 实际通过 OpenAI-compatible `/v1/chat/completions` 路径调用模型
- `MODEL_API_KEY` 也兼容读取 `GOOGLE_API_KEY`
- `MODEL_BASE_URL` 也兼容读取 `GOOGLE_BASE_URL`
- `MODEL_NAME` 也兼容读取 `GOOGLE_MODEL`

### `options` 常用字段

当前代码里实际会消费的字段包括：

```json
{
  "runtimeProvider": "model",
  "enableTools": false,
  "requireRealWebResearch": false,
  "maxToolCalls": 3,
  "contentType": "image_text_note",
  "language": "zh-CN",
  "promptOverride": "可选",
  "debugAuth": {}
}
```

字段语义：

- `runtimeProvider`
  - `"mock"`：强制走 mock runtime
  - `"model"`：走默认 model runtime
  - `"gemini"`：强制走 GeminiRuntime
- `enableTools`
  - `false`：本次请求不执行工具
  - `true`：本次请求允许进入工具链路
- `requireRealWebResearch`
  - `true`：若真实 `web_search` 失败，不允许 `mock_retrieval` 兜底
- `promptOverride`
  - 用于本地调试，临时替换系统 prompt
- `debugAuth`
  - 用于本次请求临时覆盖模型或搜索 key，不属于正式前端业务协议

### `debugAuth` 当前兼容字段

模型相关可用：

- `modelApiKey`
- `modelBaseUrl`
- `modelName`
- `googleApiKey`
- `googleBaseUrl`
- `googleModel`
- `geminiApiKey`
- `geminiBaseUrl`
- `geminiModel`

搜索相关可用：

- `webSearchApiKey`
- `webSearchProvider`

这些只应用于单次请求，不应写入正式业务数据。

### `enableTools` 的正式口径

当前需要区分：

1. Agent 是否具备工具能力
2. 当前这次请求是否允许实际执行工具

`enableTools` 控制的是第 2 层，不是第 1 层。

也就是说：

- `enableTools = false`
  - 表示当前请求策略禁止执行工具
  - 不表示 Agent 没有工具能力
- `enableTools = true`
  - 表示当前请求策略允许工具执行
  - 当前代码仍主要由 workflow 决定何时进入工具链路

当前一期正式业务策略：

- 默认 `enableTools = false`
- 工具能力继续保留
- 后续更合理的方向是让 Agent 在对话中自主判断是否需要工具，而后端只负责权限与开关

## 返回结构

Agent 当前原生返回结构：

```json
{
  "requestId": "req_20260518_0001",
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

字段说明：

| 字段 | 说明 |
| --- | --- |
| `requestId` | 原样返回 |
| `taskType` | 原样返回 |
| `platform` | 原样返回 |
| `status` | `success` / `partial_success` / `failed` |
| `data` | 当前任务的主输出 |
| `savePayload` | 建议后端保存的结构化结果 |
| `sources` | 检索来源 |
| `toolCalls` | 工具调用记录 |
| `warnings` | 非阻断性告警 |
| `error` | 失败时的错误 |
| `metadata` | runtime、模型、耗时等调试信息 |

### `metadata` 当前常见字段

根据 runtime 与 workflow 的不同，当前可能包含：

- `runtimeMode`
- `mockResponse`
- `modelProvider`
- `model`
- `baseUrl`
- `promptLoaded`
- `durationMs`
- `researchSource`
- `retrievalSource`

## 状态语义

### `success`

任务成功完成，可直接消费 `data`。

### `partial_success`

任务部分完成，常见于：

- 工具不可用但仍生成了保守结果
- 真实 `web_search` 失败后回退到了 `mock_retrieval`

当前常见场景主要出现在 `trend.track`。

### `failed`

任务失败，`error` 应包含结构化错误信息。

## 错误格式

标准错误结构：

```json
{
  "code": "MISSING_CONTEXT",
  "message": "热门追踪需要先保存人设信息。",
  "details": {
    "missing": [
      "context.savedPersona"
    ]
  }
}
```

当前常见错误码包括：

| 错误码 | 含义 |
| --- | --- |
| `INVALID_REQUEST` | 缺少必填输入或上下文 |
| `UNSUPPORTED_TASK_TYPE` | 不支持该任务 |
| `UNSUPPORTED_PLATFORM` | 当前仅支持小红书 |
| `MISSING_CONTEXT` | 缺少关键上下文 |
| `TOOL_UNAVAILABLE` | 工具不可用 |
| `REAL_WEB_RESEARCH_FAILED` | 禁止 mock 兜底时真实检索失败 |
| `MODEL_PROVIDER_UNAVAILABLE` | 模型 key 未配置或模型不可用 |
| `INTERNAL_ERROR` | workflow 内部异常 |
| `RESERVED_FEATURE` | 保留接口已暴露但未实现 |

## 任务协议

以下协议以 Agent 当前实现为准，同时补充当前 mock / schema 的兼容说明。

### `general.chat`

输入：

```json
{
  "userMessage": "你好，你能帮我做什么？"
}
```

上下文：

```json
{
  "conversationHistory": [],
  "savedPersona": null
}
```

返回核心字段：

```json
{
  "reply": "我可以帮你做人设打造、热门追踪和小红书内容撰写。",
  "suggestedActions": [
    {
      "label": "开始人设打造",
      "taskType": "persona.analyze"
    }
  ]
}
```

### `persona.analyze`

必需输入：

```json
{
  "baseInfo": {}
}
```

当前后端真实上下文通常是：

```json
{
  "userId": "demo-user",
  "history": []
}
```

返回核心字段：

```json
{
  "persona": {
    "name": "大学生成长型学习博主",
    "description": "以真实校园经验和低成本成长方法为核心的人设"
  },
  "niche": {
    "primary": "大学生成长",
    "secondary": ["学习规划", "考证经验"]
  },
  "audience": [],
  "contentStyle": [],
  "referenceCreatorDirections": [],
  "followUpQuestions": []
}
```

当前如果 `enableTools = true`，该 workflow 也支持调用检索工具做外部研究。

### `persona.follow_up`

必需输入：

```json
{
  "userMessage": "我比较擅长做计划。"
}
```

必需上下文：

```json
{
  "baseInfo": {},
  "conversationHistory": []
}
```

当前 mock 返回结构：

```json
{
  "reply": "内容",
  "nextQuestions": [],
  "isReadyToSave": true,
  "personaDraft": {}
}
```

说明：

- Agent 原始返回当前仍以 `reply`、`nextQuestions`、`personaDraft` 为主
- 后端未来会统一包入 harness 结果态壳
- 但当前一期里，人设返回壳不作为本轮强制改动项

当前 `persona.follow_up` 还没有接入正式工具调用链路。

这表示当前实现范围，不表示该任务未来不应具备按需工具能力。

### `trend.track`

必需上下文：

```json
{
  "savedPersona": {}
}
```

当前后端常传：

```json
{
  "savedPersona": {},
  "trendHistory": [],
  "conversationHistory": []
}
```

当前后端常传输入：

```json
{
  "userPreference": "我想找更容易涨粉的选题"
}
```

兼容说明：

- Agent workflow 还支持 `period` 输入
- 但当前后端 `TrendService.track()` 只显式传 `userPreference`

返回核心字段：

```json
{
  "reply": "可选的对话式回复",
  "isReadyToSave": true,
  "trendSummary": {},
  "hotTrends": [],
  "audienceNeeds": [],
  "topicOpportunities": []
}
```

Harness 结果态约定：

- 后端对前端的正式语义不再只依赖 `isReadyToSave`
- 热门追踪场景统一按两层结果态消费：
  - `discussionOnly`
  - `completeAnalysis`

`completeAnalysis` 的最低完整标准：

- `trackName`
- `trends`
- `audience`
- `topics` 至少 1 条

也就是：

- 如果只有解释、澄清、追问、闲聊式回复，则归为 `discussionOnly`
- 如果已经形成完整追踪结果，则归为 `completeAnalysis`
- 只要存在 `completeAnalysis`，前端即可进入保存链路
- 热门追踪初始页首条业务输入不得归为 `discussionOnly`，必须直接进入 `completeAnalysis`

推荐给前端的后端包装形态：

```json
{
  "discussionOnly": false,
  "completeAnalysis": {
    "trackName": "大学生成长",
    "trends": "低成本自律、早八效率、宿舍健身内容持续升温",
    "audience": "用户更想要低门槛、可立即执行、能短期看到反馈的方法",
    "topics": [
      "大学生如何低成本重启自律",
      "早八党5分钟出门流程"
    ],
    "cardPreview": {
      "discoveryKeywords": ["低成本自律", "早八效率", "宿舍健身"],
      "shortTopics": ["重启自律", "早八出门", "宿舍轻运动"]
    }
  },
  "text": "最近大学生成长赛道里，低成本、立刻能执行的内容更容易被点开和收藏。",
  "raw": {
    "reply": "最近大学生成长赛道里，低成本、立刻能执行的内容更容易被点开和收藏。",
    "isReadyToSave": true,
    "trendSummary": {},
    "hotTrends": [],
    "audienceNeeds": [],
    "topicOpportunities": []
  }
}
```

说明：

- `raw` 保留 Agent 原始结果，供兼容和排障使用
- `text` 是前端普通对话渲染的直接文本
- `completeAnalysis` 是前端结构化渲染与保存的最小正式入口
- `completeAnalysis.cardPreview` 是热门追踪初始页历史卡片的正式预览字段，由 Agent 在完整分析同次输出
- 热门追踪初始页首条业务输入必须直接命中这条完整结构化路径

如果 `enableTools = true`：

- 先尝试 `web_search`
- 失败后按配置回退 `mock_retrieval`
- 可能产生 `toolCalls`、`sources`、`warnings`

### `topic.recommend`

必需上下文：

```json
{
  "savedPersona": {},
  "trendSnapshot": {}
}
```

返回核心字段：

```json
{
  "topics": [
    {
      "title": "内容",
      "angle": "内容",
      "whyNow": "内容",
      "fitScore": 0.86,
      "startWritingInput": {
        "topic": "内容"
      }
    }
  ]
}
```

说明：

- Agent 层已支持
- 当前后端尚未单独暴露该业务接口

### `content.draft`

必需条件：

- `context.savedPersona` 存在
- `context.selectedTopic` 存在，或 `input.topic` 存在

常见输入：

```json
{
  "topic": "大学生第一次考证最容易踩的 5 个坑",
  "userInstruction": "语气真实一点"
}
```

常见上下文：

```json
{
  "savedPersona": {},
  "selectedTopic": {
    "topic": "大学生第一次考证最容易踩的 5 个坑"
  },
  "latestTrendSnapshot": {},
  "draftHistory": []
}
```

返回核心字段：

```json
{
  "draft": {
    "titleOptions": [],
    "selectedTitle": "内容",
    "body": "内容",
    "ending": "内容",
    "tags": [],
    "coverSuggestion": {},
    "imageTextStructure": [],
    "videoSuggestion": {}
  }
}
```

兼容说明：

- mock 示例里常见开头字段是 `hook`
- 模型 schema 里常见开头字段是 `intro`
- 当前前端已兼容两种字段

Harness 结果态约定：

- 内容撰写场景统一按两层结果态消费：
  - `discussionOnly`
  - `completeDraft`

`completeDraft` 最低字段：

- `title`
- `intro`
- `body`
- `ending`
- `tags`

字段约定：

- 正式字段统一使用 `intro`
- `hook` 只作为历史兼容字段保留

推荐给前端的后端包装形态：

```json
{
  "discussionOnly": false,
  "completeDraft": {
    "title": "大学生怎么低成本变自律",
    "intro": "不是每个人一开始就很自律，但你可以先从低成本的小改变开始。",
    "body": [
      "先从固定起床时间开始",
      "把任务拆到足够小",
      "不要追求一次性全改掉"
    ],
    "ending": "如果你也在重启自律，评论区聊聊你最难坚持的是哪一步。",
    "tags": ["大学生", "自律", "成长"],
    "cardPreview": {
      "keywords": ["低成本自律", "任务拆解", "重启计划"]
    }
  },
  "text": "推荐标题：大学生怎么低成本变自律",
  "raw": {
    "draft": {
      "selectedTitle": "大学生怎么低成本变自律",
      "intro": "不是每个人一开始就很自律，但你可以先从低成本的小改变开始。",
      "body": ["先从固定起床时间开始"],
      "ending": "如果你也在重启自律，评论区聊聊你最难坚持的是哪一步。",
      "tags": ["大学生", "自律", "成长"]
    }
  }
}
```

说明：

- `completeDraft.cardPreview` 是内容撰写初始页草稿卡片的正式预览字段，由 Agent 在完整草稿同次输出。
- 后端负责归一化、保存和透传该字段。
- 前端不得把 `intro`、`hook` 或 `body` 截断后当作草稿卡片摘要。
- 内容撰写初始页首条业务输入不得归为 `discussionOnly`，必须直接进入 `completeDraft`

Suggestions 约定：

- 内容页的改写建议 chips 不再视为前端静态规则
- 作为 Agent / 后端返回的一种正式结构，由前端直接展示
- 定位为“系统推测用户可能提出的修改建议”

推荐字段：

```json
[
  {
    "label": "把标题改得更像搜索词",
    "instruction": "请把标题改得更像小红书搜索词，保留大学生和低成本自律两个关键词。",
    "intent": "title_optimize"
  },
  {
    "label": "开头更强一点",
    "instruction": "请把开头改得更抓人，先抛出一个大学生很容易共鸣的具体场景。",
    "intent": "intro_optimize"
  }
]
```

规则：

- 仅在返回完整 `completeDraft` 时附带
- 与 draft 同次返回
- `discussionOnly` 场景不返回 suggestions

当前代码状态：

- 后端 `ContentService` 已返回 `discussionOnly`、`completeDraft`、`suggestions`、`text`、`raw`
- 前端内容页已直接消费 `suggestions`，不再本地生成静态改写建议

如果 `enableTools = true`，`content.draft` 当前也支持进入统一检索链路。

### `content.revise`

必需条件：

- `context.currentDraft` 存在
- `context.savedPersona` 存在
- `input.revisionInstruction` 存在

常见输入：

```json
{
  "topic": "原选题",
  "userInstruction": "原始补充要求",
  "currentDraft": {},
  "revisionInstruction": "标题更吸引人一点"
}
```

返回核心字段：

```json
{
  "revisedDraft": {},
  "changes": [
    {
      "field": "titleOptions",
      "reason": "增强点击动机"
    }
  ]
}
```

说明：

- `content.revise` 与 `content.draft` 共用同一套 harness 结果态语义
- 如果只是继续讨论修改方向，则归入 `discussionOnly`
- 如果已经产出完整改稿结果，则归入 `completeDraft`
- 后端当前仍通过 `POST /api/content/draft` 分支进入该任务

当前 `content.revise` 还没有接入正式工具调用链路。

同样，这应视为一期当前实现边界，而不是长期设计原则。

## `savePayload`

`savePayload` 表示 Agent 建议后端保存的业务数据，不表示 Agent 已落库。

标准结构：

```json
{
  "type": "content_draft",
  "suggestedCollection": "content_drafts",
  "data": {}
}
```

当前常见 `type` 包括：

- `general_chat_turn`
- `persona_result`
- `persona_conversation_turn`
- `trend_tracking_result`
- `topic_recommendation`
- `content_draft`
- `content_revision`

说明：

- mock 示例里的 `suggestedCollection` 与后端真实 CRUD 集合命名并不总是完全一致
- 当前后端需要按业务代码而不是仅按文档名义去决定最终落库位置

## `sources`

当检索成功时，`sources` 当前格式为：

```json
[
  {
    "sourceType": "web_search",
    "title": "标题",
    "url": "https://example.com",
    "summary": "摘要",
    "retrievedAt": "2026-05-18T10:00:00+00:00"
  }
]
```

说明：

- 只有检索成功才会生成
- 当前后端默认不会把它继续透传给前端

## `toolCalls`

当前 `toolCalls` 格式为：

```json
[
  {
    "toolName": "retrieval.search",
    "toolType": "retrieval",
    "status": "success",
    "inputSummary": {
      "source": "web_search",
      "query": "小红书 大学生成长 热门选题",
      "platform": "xiaohongshu",
      "limit": 3
    },
    "outputSummary": {
      "itemCount": 3,
      "status": "success"
    },
    "durationMs": 900,
    "error": null
  }
]
```

失败时 `status = "failed"`，并附带 `error`。

## 保留接口

### `POST /agent/jobs`

当前已暴露，但只返回 `reserved`：

```json
{
  "status": "reserved",
  "jobId": null,
  "error": {
    "code": "RESERVED_FEATURE",
    "message": "Async Agent jobs are reserved for a later phase."
  },
  "metadata": {
    "syncEndpoint": "/agent/run"
  }
}
```

### `GET /agent/jobs/{job_id}`

同样只返回 `reserved`，不进入真实异步队列。

## 调试接口说明

以下接口只用于本地 Prompt Lab 和 provider 验证，不属于后端正式业务协议：

- `GET /prompt-lab`
- `GET /debug`
- `POST /debug/tavily/test`
- `POST /debug/tavily/search`
- `POST /debug/gemini/prompt-lab`
- `POST /debug/model/prompt-lab`

其中：

- `/debug` 与 `/prompt-lab` 当前实际指向同一个页面
- Prompt Lab 支持 Anthropic、GLM、Qwen、Gemini、Tavily 等调试

## 当前决策总结

- 统一业务入口仍然是 `POST /agent/run`
- 当前代码使用 `MODEL_*` 统一模型配置，不再使用旧版 `DEEPSEEK_*`
- Agent workflow 已支持工具检索与 fallback
- 当前后端主链路默认把 `enableTools` 设为 `false`
- `topic.recommend` 在 Agent 层可用，但后端尚未单独暴露
- `content.revise` 在 Agent 层可用，后端通过 `POST /api/content/draft` 分支进入
- 正确方向是：保留 Agent 智能调用工具的能力，用 `enableTools` 控制当前是否允许实际执行工具，正式业务默认关闭。
