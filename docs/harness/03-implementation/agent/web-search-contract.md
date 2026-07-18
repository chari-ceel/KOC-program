# Web Search 接口规格

本文档基于当前 `agent/app/tools/web_search.py`、`agent/app/tools/registry.py` 与相关 workflow 代码，定义 KOC Agent 一期 `web_search` 的真实行为。

当前不再区分 `web_search` 和 `web_research`。一期统一使用：

```text
web_search
```

它的职责是：

- 搜索网站或平台相关内容
- 将结果标准化为 `RetrievalToolResult`
- 交给 Agent workflow 再做总结、筛选、热点判断和生成

`web_search` 不直接输出最终业务答案，也不直接保存数据库。

## 当前定位

当前链路是：

```text
workflow
→ ToolRegistry.search_with_fallback()
→ WebSearchTool.search()
→ provider 返回结果
→ 标准化为 RetrievalToolResult
→ workflow 转成 sources / toolCalls / warnings
```

## 当前使用场景

当前代码层面，`web_search` 可以被以下 workflow 使用：

- `persona.analyze`
- `trend.track`
- `content.draft`

但有一个很关键的现状：

- 当前后端主业务链路默认传 `enableTools = false`
- 所以前后端正常业务联调时，默认不会真正触发 `web_search`

要验证 `web_search`，通常需要直接调 Agent `/agent/run`，或者显式把 `enableTools` 打开。

## 当前 provider 支持

当前 `WebSearchTool` 实际支持以下 provider：

- `tavily`
- `gemini`
- `gemini_grounding`
- `google`

说明：

- `gemini`、`gemini_grounding`、`google` 在当前实现中都走 Gemini Grounding 搜索路径
- 不再是旧文档里那种“未来 provider 待定”的状态

## provider 选择逻辑

当前 provider 的确定顺序大致是：

1. `filters.debugAuth.webSearchProvider`
2. 环境变量 `WEB_SEARCH_PROVIDER`
3. 如果有调试 key 但 provider 未指定，则默认尝试 `tavily`

API key 选择顺序大致是：

1. `filters.debugAuth` 中的调试 key
2. `WEB_SEARCH_API_KEY`
3. `MODEL_API_KEY`

## 请求结构

`web_search` 走的仍然是统一 `RetrievalToolRequest`：

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

### 请求字段

| 字段 | 必填 | 当前说明 |
| --- | --- | --- |
| `toolType` | 是 | 固定 `retrieval` |
| `source` | 是 | 必须是 `web_search` |
| `query` | 是 | 搜索 query |
| `platform` | 否 | 默认 `xiaohongshu` |
| `limit` | 否 | 默认 `10` |
| `filters` | 否 | 附加过滤与调试参数 |
| `timeoutMs` | 否 | schema 默认 `8000`，但 `WebSearchTool` 最终主要看环境变量 `WEB_SEARCH_TIMEOUT_MS` |

### 当前常见 `filters`

当前代码中真实会用到：

- `period`
- `contentType`
- `niche`
- `language`
- `debugAuth`
- `allowMockFallback`

旧文档里常见的 `timeRange` 当前不是主用字段。

## 当前环境变量

`web_search` 相关环境变量：

```text
ENABLE_WEB_SEARCH=true
WEB_SEARCH_PROVIDER=
WEB_SEARCH_API_KEY=
WEB_SEARCH_TIMEOUT_MS=8000
ENABLE_DEBUG_AUTH=true
```

### 工具不可用的常见原因

当前会返回标准化失败的场景包括：

- `ENABLE_WEB_SEARCH=false`
- `WEB_SEARCH_PROVIDER` 未配置
- API key 未配置
- provider 超时
- provider HTTP 错误
- 其他网络异常

## Tavily 路径

当 provider 为 `tavily` 时，当前实现会请求：

```text
POST https://api.tavily.com/search
```

当前发送的主要字段：

```json
{
  "query": "小红书 大学生成长 热门选题",
  "max_results": 3,
  "include_answer": false,
  "include_raw_content": false
}
```

标准化后每条结果大致映射为：

```json
{
  "title": "标题",
  "url": "https://example.com",
  "summary": "内容片段",
  "platform": "xiaohongshu",
  "contentType": "image_text_note",
  "retrievedAt": "2026-05-18T10:00:00+00:00",
  "metadata": {
    "provider": "tavily",
    "score": 0.91
  }
}
```

说明：

- `publishedAt` 当前 Tavily 路径一般拿不到
- `metrics` 当前也不会伪造

## Gemini Grounding 路径

当 provider 为：

- `gemini`
- `gemini_grounding`
- `google`

当前实现会走 Gemini Grounding 搜索。

它会：

- 调用 Gemini generate_content
- 打开 `google_search` 工具
- 读取 grounding source

标准化规则：

- 第一条 item 会带搜索总结的 `summary`
- 后续 item 主要带来源标题与 URL
- `metadata.provider = "gemini_grounding"`
- `metadata.model = 当前 MODEL_NAME`

如果没有 grounding source，但有文本总结，当前仍可能生成一个只有总结的结果项。

## 返回结构

当前统一返回 `RetrievalToolResult`：

```json
{
  "source": "web_search",
  "status": "success",
  "items": [
    {
      "title": "大学生期末复习计划表",
      "url": "https://example.com/item/1",
      "summary": "该内容提供 7 天期末复习计划和时间表模板。",
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
      "metadata": {
        "provider": "tavily"
      }
    }
  ],
  "warnings": [],
  "error": null
}
```

### 返回字段说明

| 字段 | 当前说明 |
| --- | --- |
| `source` | 固定为 `web_search` |
| `status` | `success` / `empty` / `failed` |
| `items` | 标准化搜索结果 |
| `warnings` | 当前通常为空 |
| `error` | 失败时存在 |

## 失败结构

当前统一失败结构示例：

```json
{
  "source": "web_search",
  "status": "failed",
  "items": [],
  "warnings": [],
  "error": {
    "code": "TOOL_UNAVAILABLE",
    "message": "WEB_SEARCH_PROVIDER is not configured.",
    "details": {
      "source": "web_search"
    }
  }
}
```

也可能出现类似消息：

- `Web search is disabled by ENABLE_WEB_SEARCH.`
- `Web search API key is not configured.`
- `Web search request timed out.`
- `Web search provider returned HTTP 4xx/5xx.`
- `Unsupported web search provider: xxx`
- `Gemini grounding search request failed: ...`

## fallback 与 Agent 降级规则

当前 fallback 不在 `WebSearchTool` 内部，而在 `ToolRegistry.search_with_fallback()` 中完成。

真实链路：

```text
web_search 失败
→ 若 allowMockFallback != false
→ 自动再尝试 mock_retrieval
```

然后由 workflow 决定 Agent 的最终状态：

### `requireRealWebResearch = true`

如果真实 `web_search` 没成功，则 workflow 返回：

- `status = "failed"`
- `error.code = "REAL_WEB_RESEARCH_FAILED"`

### `requireRealWebResearch = false`

若 fallback 到 `mock_retrieval`：

- workflow 通常继续返回可用结果
- 并在 `warnings` 中写入 `MOCK_RETRIEVAL_USED`

若工具完全失败：

- `trend.track` 当前会把 Agent response 置为 `partial_success`
- 并写入 `TOOL_UNAVAILABLE`

## `sources` 映射

当前只有当 `RetrievalToolResult.status == "success"` 时，才会映射到 Agent `sources`。

映射示例：

```json
{
  "sourceType": "web_search",
  "title": "大学生期末复习计划表",
  "url": "https://example.com/item/1",
  "summary": "该内容提供 7 天期末复习计划和时间表模板。",
  "retrievedAt": "2026-05-18T10:00:00+00:00"
}
```

如果真实搜索失败但 fallback 到 `mock_retrieval` 成功，则最终 `sources.sourceType` 会是：

```text
mock_retrieval
```

## `toolCalls` 映射

每次搜索都会留下 `toolCalls`。

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
  "durationMs": 1200,
  "error": null
}
```

如果发生 fallback，则通常会出现两条：

1. `web_search` 的失败记录
2. `mock_retrieval` 的成功记录

## 当前代码位置

- Schema: `agent/app/schemas/tools.py`
- 协议辅助: `agent/app/tools/retrieval.py`
- 注册器: `agent/app/tools/registry.py`
- 真实搜索: `agent/app/tools/web_search.py`
- mock 搜索: `agent/app/tools/mock_retrieval.py`
- 使用方: `agent/app/workflows/persona.py`
- 使用方: `agent/app/workflows/trend_tracking.py`
- 使用方: `agent/app/workflows/content_writing.py`

## 调试建议

如果你要单独验证 `web_search`，建议不要走当前后端默认链路，而是直接请求 Agent：

```json
{
  "requestId": "req_web_search_debug_001",
  "taskType": "trend.track",
  "platform": "xiaohongshu",
  "userId": "demo-user",
  "input": {
    "userPreference": "大学生成长 热门选题"
  },
  "context": {
    "savedPersona": {
      "niche": {
        "primary": "大学生成长"
      }
    }
  },
  "options": {
    "runtimeProvider": "model",
    "enableTools": true,
    "requireRealWebResearch": false
  }
}
```

## 后续接入验收标准

按当前代码口径，`web_search` 验收更适合看这些点：

- `GET /agent/tools` 能正确反映 `web_search` 是否 `available`
- `web_search` 成功时能产出标准化 `items`
- fallback 生效时，`toolCalls` 中有两条记录
- `trend.track` 能根据 fallback 情况返回 `warnings`
- 失败时返回结构化 `error`，不会让服务崩溃
- 不伪造真实来源、发布时间或互动指标

## 当前决策总结

- 一期真实 `web_search` 已有实现，不再只是预留
- 当前 provider 真实支持 Tavily 与 Gemini Grounding 路径
- fallback 逻辑在 `ToolRegistry`，不是写死在 workflow 或 schema 层
- 当前后端主链路默认 `enableTools = false`，所以业务联调默认不会触发真实搜索
- 真实返回应以 `RetrievalToolResult` schema 和工具实现为准，不以旧样例文案为准
