# Agent 工具协议

## 目标

本文档基于当前 `agent/app/tools/*` 与 `agent/app/schemas/tools.py` 代码，定义 KOC Agent 侧工具协议的真实结构与当前行为。

当前一期重点仍然是统一检索工具，也就是 `RetrievalTool`。

## 工具归属原则

Agent 侧工具负责：

- 搜索
- 检索
- 规则读取
- 外部来源归一化
- 工具调用记录

后端侧工具负责：

- 业务数据读写
- 用户信息
- 权限
- 数据库
- 业务历史查询

Agent 不通过工具直接写后端数据库。

## 当前工具分类

当前代码里正式定义了：

- `RetrievalTool`

当前保留但未实现：

- `ContextProviderTool`
- `AgentMemoryTool`

## `RetrievalTool`

### 用途

当前 `RetrievalTool` 统一抽象以下 source：

- `web_search`
- `mock_retrieval`
- `browser_search`，预留
- `xhs_fetcher`，预留
- `builtin_trend_store`，预留
- `official_rule_store`，预留

业务 workflow 不应直接依赖某个 provider，而应依赖统一检索协议。

### `source` 枚举

当前 `agent/app/schemas/tools.py` 中定义为：

```text
web_search
browser_search
xhs_fetcher
builtin_trend_store
official_rule_store
mock_retrieval
```

状态说明：

| `source` | 当前状态 | 说明 |
| --- | --- | --- |
| `web_search` | 已实现 | 真实搜索入口 |
| `mock_retrieval` | 已实现 | fallback / 本地 mock |
| `browser_search` | reserved | 当前只会返回保留错误 |
| `xhs_fetcher` | reserved | 当前只会返回保留错误 |
| `builtin_trend_store` | reserved | 当前只会返回保留错误 |
| `official_rule_store` | reserved | 当前只会返回保留错误 |

## 当前执行策略

当前真实策略由 `ToolRegistry.search_with_fallback()` 决定：

```text
先尝试 request.source
如果 source 是 web_search 且失败
并且 filters.allowMockFallback != false
则自动再尝试 mock_retrieval
```

也就是说当前真实逻辑不是“工具层自动 partial_success”，而是：

1. 工具层返回 `RetrievalToolResult`
2. workflow 决定是否把 Agent response 标成 `partial_success` 或 `failed`

## 工具能力与开关策略

当前工具设计需要明确区分两层：

### 1. 能力层

Agent 应保留“在对话过程中自主判断是否需要调用工具”的能力。

这里的“保留能力”指的是：

- 工具协议继续存在
- workflow 可以接入工具
- runtime / workflow 后续可演进为更 agentic 的 tool-use 形态
- 不能因为一期暂时默认关闭工具，就把工具能力从架构上删掉

### 2. 策略层

当前是否允许实际调用工具，由请求级开关控制，而不是由前端页面临时拼规则决定。

当前主要开关是：

- `request.options.enableTools`

口径：

- `enableTools = false`
  - 本次请求不实际调用工具
  - Agent 仍然保留工具能力，只是本轮策略禁止执行
- `enableTools = true`
  - 本次请求允许 workflow 进入工具链路
  - 当前代码仍由 workflow 决定何时构造 `RetrievalToolRequest`

### 当前一期正式策略

当前一期的正式业务策略是：

- 保留 Agent 工具能力
- 通过开关控制是否允许使用工具
- 后端主业务链路默认 `enableTools = false`

这意味着当前产品默认行为不是“自动联网搜索”，而是：

- 正式业务默认关闭工具
- 调试、Prompt 实验或后续灰度链路可以单独打开

### 关于“智能调用工具”的当前状态

当前代码已经具备：

- 统一工具协议
- 统一 `ToolRegistry`
- 统一 fallback
- 按 taskType 接入工具的 workflow 入口

但当前还没有完全进入“模型自主 function calling / tool calling loop”阶段。

现状更接近：

- workflow 预埋式工具调用
- 请求级开关控制是否允许执行

目标方向应保持为：

- Agent 自主判断是否需要工具
- 后端只控制是否放开工具权限、预算和策略
- 不由前端或后端写死“某类问题绝不能查工具”

## 请求结构

当前 schema 为 `RetrievalToolRequest`：

```json
{
  "toolType": "retrieval",
  "source": "web_search",
  "query": "小红书 大学生成长 热门选题",
  "platform": "xiaohongshu",
  "limit": 3,
  "filters": {
    "period": "7d",
    "contentType": "image_text_note",
    "niche": "大学生成长",
    "language": "zh-CN",
    "debugAuth": {},
    "allowMockFallback": true
  },
  "timeoutMs": 8000
}
```

字段说明：

| 字段 | 必填 | 当前说明 |
| --- | --- | --- |
| `toolType` | 是 | 固定为 `retrieval` |
| `source` | 是 | 检索来源 |
| `query` | 是 | 查询词 |
| `platform` | 否 | 默认 `xiaohongshu` |
| `limit` | 否 | 默认 `10` |
| `filters` | 否 | 附加过滤条件 |
| `timeoutMs` | 否 | 默认 `8000` |

### 当前常见 `filters`

当前 workflow 与 tool 代码里真实会用到的有：

- `period`
- `contentType`
- `niche`
- `language`
- `debugAuth`
- `allowMockFallback`

需要注意：

- `timeRange` 是旧文档常见写法
- 当前代码里更常见的是 `period`

## 返回结构

当前 schema 为 `RetrievalToolResult`：

```json
{
  "source": "web_search",
  "status": "success",
  "items": [
    {
      "title": "标题",
      "url": "https://example.com",
      "summary": "摘要",
      "platform": "xiaohongshu",
      "contentType": "image_text_note",
      "publishedAt": null,
      "retrievedAt": "2026-05-18T10:00:00+00:00",
      "metrics": {
        "likes": null,
        "saves": null,
        "comments": null,
        "shares": null
      },
      "metadata": {}
    }
  ],
  "warnings": [],
  "error": null
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `source` | 实际来源 |
| `status` | `success` / `empty` / `failed` |
| `items` | 结果数组 |
| `warnings` | 工具层警告 |
| `error` | 工具层错误 |

## `RetrievalItem` 当前字段

当前代码定义为：

- `title`
- `url`
- `summary`
- `platform`
- `contentType`
- `publishedAt`
- `retrievedAt`
- `metrics`
- `metadata`

其中：

- `retrievedAt` 会自动补当前 UTC 时间
- `metrics` 默认是空结构，不要求 provider 必须返回真实互动数据
- `metadata` 用于 provider 私有信息，例如 `provider`、`score`、`mock`

## 空结果

当工具正常执行但没有结果时，当前标准返回是：

```json
{
  "source": "web_search",
  "status": "empty",
  "items": [],
  "warnings": [],
  "error": null
}
```

需要注意：

- `examples/tool-results/retrieval.empty.json` 只是最小样例
- 文件本身可能没有显式写出 `status`
- 真实运行时应以 `RetrievalToolResult` schema 和工具代码为准

当前 workflow 侧如何处理空结果：

- `result_to_sources()` 不会生成来源
- workflow 可继续生成结果
- 是否变成 `partial_success` 由具体 workflow 决定

## 工具失败

当前统一失败结构来自 `unavailable_result()`：

```json
{
  "source": "web_search",
  "status": "failed",
  "items": [],
  "warnings": [],
  "error": {
    "code": "TOOL_UNAVAILABLE",
    "message": "Web search API key is not configured.",
    "details": {
      "source": "web_search"
    }
  }
}
```

当前常见失败来源：

- `ENABLE_WEB_SEARCH=false`
- `WEB_SEARCH_PROVIDER` 未配置
- API key 未配置
- provider HTTP 异常
- 超时
- reserved source
- unknown source

### reserved / unknown source 的真实错误码

当前 `ToolRegistry` 对未实现 source 返回：

- `RESERVED_TOOL`

对未知 source 返回：

- `UNKNOWN_TOOL`

## 超时和重试

当前真实实现：

- `web_search` 超时时间来自 `WEB_SEARCH_TIMEOUT_MS`
- 但最小会被规范到 `1` 秒以上
- `GeminiRuntime` 内部模型调用有自己的 3 次重试
- `WebSearchTool` 当前没有应用层重试循环

因此旧文档中“默认重试 1 次”这类说法不应再视为现状。

## `web_search` 当前 provider 适配

当前 `WebSearchTool` 实际支持：

- `tavily`
- `gemini`
- `gemini_grounding`
- `google`

其中：

- `tavily` 走 `https://api.tavily.com/search`
- `gemini` / `gemini_grounding` / `google` 走 Gemini Grounding 搜索路径

当前 provider 选择顺序大致是：

1. 先看 `filters.debugAuth.webSearchProvider`
2. 再看 `WEB_SEARCH_PROVIDER`
3. 如果调试 key 存在但 provider 没填，则默认尝试 `tavily`

## `mock_retrieval` 当前行为

当前 `MockRetrievalTool` 会固定读取：

```text
examples/tool-results/retrieval.xhs_trends.success.json
```

特点：

- 不会动态切换别的 mock 文件
- 结果为空则返回 `status = "empty"`
- 文件缺失则返回标准化失败结果

因此当前 `examples/tool-results/retrieval.empty.json` 与 `retrieval.tool_unavailable.json` 更适合作为说明或测试样例，不代表 `MockRetrievalTool` 会自动按场景切换读取。

## `sources` 映射规则

当前 `result_to_sources()` 的真实映射规则是：

- 只有 `result.status == "success"` 才会生成 `sources`
- `empty` 或 `failed` 时返回空数组

映射结构：

```json
{
  "sourceType": "web_search",
  "title": "标题",
  "url": "https://example.com",
  "summary": "摘要",
  "retrievedAt": "2026-05-18T10:00:00+00:00"
}
```

说明：

- `sourceType` 直接等于 `RetrievalToolResult.source`
- 如果 fallback 后实际用了 `mock_retrieval`，那这里也会是 `mock_retrieval`

## `toolCalls` 记录

当前每次检索会通过 `timed_search()` 生成一个 `ToolCall`。

成功示例：

```json
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
```

失败示例：

```json
{
  "toolName": "retrieval.search",
  "toolType": "retrieval",
  "status": "failed",
  "inputSummary": {
    "source": "web_search",
    "query": "小红书 大学生成长 热门选题",
    "platform": "xiaohongshu",
    "limit": 3
  },
  "outputSummary": {
    "itemCount": 0,
    "status": "failed"
  },
  "durationMs": 1200,
  "error": {
    "code": "TOOL_UNAVAILABLE",
    "message": "WEB_SEARCH_PROVIDER is not configured.",
    "details": {
      "source": "web_search"
    }
  }
}
```

### fallback 时的 `toolCalls`

如果 `web_search` 失败后回退到 `mock_retrieval`，当前会写入两条记录：

1. `web_search` 的失败记录
2. `mock_retrieval` 的成功或失败记录

## workflow 如何消费工具结果

当前与工具最相关的 workflow 有：

- `PersonaWorkflow.analyze()`
- `TrendTrackingWorkflow.track()`
- `ContentWritingWorkflow.draft()`

当前行为要点：

- 只有 `request.options.enableTools = true` 时才会真正调用工具
- 当前后端主业务链路默认都把 `enableTools` 设为 `false`
- 因此工具协议目前更多用于 Agent 独立调试、Prompt 实验和后续扩展

需要特别说明：

- 当前不是所有 task 都已接入工具
- 当前主要接入的是首轮生成 / 分析任务
- `persona.follow_up`、`content.revise`、`general.chat` 目前没有接入正式工具调用链路

这不代表这些任务未来不应该具备工具能力。

更合适的后续方向是：

- 保留所有对话任务未来按需智能调用工具的可能性
- 当前仅在正式策略上默认关闭，而不是在架构上彻底排除

## `ContextProviderTool`，预留

当前 `/agent/tools` 会返回：

```json
{
  "toolType": "context_provider",
  "status": "reserved"
}
```

但当前没有真实实现。

## `AgentMemoryTool`，预留

当前 `/agent/tools` 会返回：

```json
{
  "toolType": "agent_memory",
  "status": "reserved"
}
```

但当前没有真实实现。

## 一期样例文件

当前相关样例文件包括：

```text
examples/tool-results/retrieval.xhs_trends.success.json
examples/tool-results/retrieval.empty.json
examples/tool-results/retrieval.tool_unavailable.json
```

说明：

- 这些文件更像样例输入素材
- 真实返回结构以 `agent/app/schemas/tools.py` 和工具实现为准

## 当前决策总结

- 当前一期真正实现并会运行的是 `web_search` 与 `mock_retrieval`
- reserved source 当前不会执行真实逻辑，只会返回标准化错误
- fallback 逻辑发生在 `ToolRegistry.search_with_fallback()`，不是发生在 schema 层
- 只有 `status = "success"` 的检索结果才会映射成 Agent `sources`
- 当前后端主业务链路默认把 `enableTools` 设为 `false`
- 当前正确方向是“保留 Agent 智能调用工具的能力，用开关控制当前是否允许执行工具”
