# 热门追踪 Workflow

## 目标

热门追踪 workflow 用于帮助用户理解小红书当前赛道中的：

- 近一周热点趋势
- 目标受众需求
- 适合用户人设的选题机会
- 可进入内容撰写的选题入口

一期对应两个任务：

```text
trend.track
topic.recommend
```

## 输入边界

### `trend.track`

必需 `input`：

```json
{
  "userPreference": "我想找更容易涨粉的选题",
  "period": "7d"
}
```

必需 `context`：

```json
{
  "savedPersona": {}
}
```

可选 `context`：

```json
{
  "trendHistory": [],
  "conversationHistory": [],
  "retrievalResults": []
}
```

### 热门追踪初始页首条输入约束

- 当用户位于热门追踪初始页，且当前还没有有效热门追踪结果时，第一条业务输入必须直接产出完整结构化结果。
- 这里的“第一条业务输入”包括简短赛道名、偏好描述、方向描述、选题方向描述，不要求用户必须显式说“开始追踪”或“输出完整报告”。
- 该轮后端除了设置强制结构化选项外，还应把用户原始输入包装成一段“请直接输出完整热门追踪结果”的明确任务文案，再发送给 Agent。
- 该轮返回必须满足：
  - `discussionOnly = false`
  - `completeAnalysis` 存在
  - `raw.isReadyToSave = true`
  - `cardPreview` 存在
- 只有进入后续连续对话后，才允许根据用户意图返回讨论态。

### 热门追踪聊天页实时总结约束

- 该约束只适用于 `热门追踪` 聊天页，不适用于通用聊天、人设打造或内容撰写。
- 热门追踪聊天页允许两个“主动刷新概要”的入口：
  - 点击任一条 `assistant` 回复旁边的保存按钮
  - 点击输入框上方的 `总结实时进度` 按钮
- 这两个入口都用于刷新当前热门追踪概要，但保存按钮内部需要区分消息类型：
  - 如果点击的是带完整 `analysis` 的结构化 assistant 消息保存按钮，前端可直接使用该结构化结果更新并保存，不必重新总结
  - 如果点击的是普通 assistant 文本消息保存按钮，或点击输入框上方的 `总结实时进度` 按钮，则必须走 `热门追踪专属实时总结` 链路
- 该链路必须把当前热门追踪会话里的全部可见聊天记录作为 `summarySourceConversation` 重新发给后端，再由后端调用 Agent 生成一版新的完整热门追踪结果。
- `summarySourceConversation` 是热门追踪实时总结的专属总结素材，不等同于普通续聊用的 `conversationHistory`。
- 普通 `conversationHistory` 继续只表示让 Agent 延续当前对话的最近上下文，默认不超过最近 12 条。
- 该次请求必须满足：
  - 只在 `trend.track` 场景内执行
  - `discussionOnly = false`
  - `completeAnalysis` 存在
  - `cardPreview` 存在
- 返回结果必须被前端直接用于刷新当前热门追踪概要展示，以及历史卡片所依赖的 `cardPreview` 数据。
- 该次实时总结结果默认只回传给概要图 / 历史卡片更新链路，不要求额外在聊天流里插入一条新的“总结消息”。
- 如果用户在实时总结过程中主动点击停止，本次总结请求必须被中断；中断后的结果不得继续回传概要图，也不得触发保存。
- 停止后前端应展示一条明确状态，例如 `Agent 总结中断。`
- 其中“保存”入口在获得最终结构化结果后，还应继续调用趋势保存接口，把新的总结结果落入热门追踪历史。
- “总结实时进度”入口只负责刷新当前概要，不要求自动落库。
- 同一条热门追踪记录在连续对话中如果已经切换为新的明确话题，后续保存应以最新结构化结果覆盖当前记录，而不是继续把更早的话题当成主概要。
- 热门追踪保存时，除 `completeAnalysis / cardPreview` 外，还应一并保存当前热门追踪会话的完整可见 `conversationHistory`，用于用户从历史记录重入时恢复聊天现场。
- 用户从概要图或历史卡片重新进入该记录时，前端应优先恢复这份完整会话，不应只临时拼接一条摘要消息。

### `topic.recommend`

必需 `input`：

```json
{
  "preference": "更生活化一点",
  "count": 3
}
```

必需 `context`：

```json
{
  "savedPersona": {},
  "trendSnapshot": {}
}
```

可选 `context`：

```json
{
  "topicHistory": []
}
```

## `trend.track` 处理流程

```text
1. 校验 savedPersona 是否存在。
2. 从 savedPersona 中提取：
   - persona name
   - niche
   - audience
   - contentStyle
3. 结合 userPreference 生成检索 query。
4. 判断 context.retrievalResults 是否已有可用结果。
5. 如果已有 retrievalResults，优先使用后端传入结果。
6. 如果没有 retrievalResults，尝试调用 RetrievalTool。
7. 如果 RetrievalTool 不可用，基于 savedPersona 和 trendHistory 生成保守结果。
8. 对检索结果进行轻量去重和归类。
9. 提炼 hotTrends。
10. 提炼 audienceNeeds。
11. 生成 topicOpportunities。
12. 同步生成 cardPreview，用于热门追踪初始页历史卡片。
13. 如果当前是热门追踪初始页首条输入，强制本轮落到完整结构化结果主路径。
14. 如果当前请求是热门追踪聊天页的实时总结，基于整段聊天记录回收当前阶段结论并强制输出完整结构化结果。
15. 返回 trendSummary、hotTrends、audienceNeeds、topicOpportunities、cardPreview、sources、toolCalls、savePayload。
```

## `topic.recommend` 处理流程

```text
1. 校验 savedPersona 和 trendSnapshot 是否存在。
2. 读取用户偏好 preference。
3. 从 trendSnapshot 中提取热点趋势和受众需求。
4. 结合用户人设筛选适配选题。
5. 生成 count 个选题。
6. 为每个选题生成：
   - title
   - angle
   - whyNow
   - fitScore
   - startWritingInput
7. 返回 topics 和 savePayload。
```

`startWritingInput` 的作用是为内容撰写页提供可直接消费的页面联动入口信息。

当前正式口径：

- 至少包含 `topic`
- 推荐同时包含 `writingEntrySource`
- 不在 `startWritingInput` 中传递 `topicHistory`、`trendHistory`、`conversationHistory`

## 工具调用

### 使用工具

热门追踪可以调用：

```text
RetrievalTool
```

可能的 `source`：

```text
mock_retrieval
web_search
browser_search
xhs_fetcher
builtin_trend_store
official_rule_store
```

一期真实工具未确定时，优先使用：

```text
mock_retrieval
```

### 查询建议

Agent 可根据人设生成 query，例如：

```text
小红书 大学生成长 热门选题
小红书 考证规划 避坑 笔记
小红书 低成本成长 收藏
```

### 工具失败降级

如果工具失败：

```text
1. 写入 toolCalls。
2. 基于 savedPersona、trendHistory 或已有 context 生成保守结果。
3. 返回 partial_success。
4. 在 warnings 中说明外部热点数据暂不可用。
```

## 输出结构

### `trend.track`

```json
{
  "trendSummary": {
    "period": "7d",
    "platform": "xiaohongshu",
    "niche": "大学生成长",
    "summary": "近一周低成本、可执行、少踩坑类内容更容易被收藏。"
  },
  "hotTrends": [
    {
      "name": "低成本成长",
      "reason": "用户更愿意收藏可直接复用的方法和清单",
      "heatLevel": "high"
    }
  ],
  "audienceNeeds": [
    {
      "need": "快速上手",
      "evidence": "相关内容集中在新手、少踩坑、清单类表达",
      "confidence": "medium"
    }
  ],
  "topicOpportunities": [
    {
      "title": "大学生第一次考证最容易踩的 5 个坑",
      "angle": "用真实踩坑经验降低新手焦虑",
      "fitReason": "匹配学习规划人设和新手受众",
      "difficulty": "low"
    }
  ],
  "cardPreview": {
    "discoveryKeywords": ["低成本成长", "考证避坑", "收藏清单"],
    "shortTopics": ["考证避坑", "低成本自律", "期末复习清单"]
  }
}
```

### `cardPreview`

`cardPreview` 是 Agent 在生成完整热门追踪结构时同步输出的卡片预览字段，用于热门追踪初始页历史卡片。

它不是：

- 前端从长摘要中截断出来的文本
- 后端二次调用模型提炼出的结果
- 对 `trends`、`audience`、`topics` 的替代

它是：

- 完整分析结果的轻量索引
- 初始页快速扫读信息
- 点击进入详情前的线索提示

字段规则：

- `discoveryKeywords`：本次发现的趋势关键词，来自当前完整分析结果。
- `shortTopics`：适合选题的短选题，来自当前 `topicOpportunities` 或 `topics`。
- 两个数组各输出 2-3 条。
- 单条应为短语，不应为完整解释句。
- 单条建议 4-10 个中文字符，最多不超过 14 个中文字符。

合格示例：

```json
{
  "discoveryKeywords": ["平价替代", "新手化妆", "通勤妆"],
  "shortTopics": ["新手通勤妆", "百元彩妆清单", "底妆避坑"]
}
```

不合格示例：

```json
{
  "discoveryKeywords": ["用户最近更喜欢低成本通勤妆内容"],
  "shortTopics": ["教新手如何在预算有限的情况下完成一套适合上班的通勤妆"]
}
```

### `topic.recommend`

```json
{
  "topics": [
    {
      "title": "大学生第一次考证前，我最想知道的 5 件事",
      "angle": "用真实经历降低新手焦虑",
      "whyNow": "考证规划和避坑类内容适合收藏",
      "fitScore": 0.91,
      "startWritingInput": {
        "topic": "大学生第一次考证前，我最想知道的 5 件事",
        "writingEntrySource": {
          "sourceType": "hot_tracking",
          "trackId": "track_xxx",
          "trackName": "大学生成长赛道",
          "topicId": "topic_xxx",
          "topicTitle": "大学生第一次考证前，我最想知道的 5 件事"
        }
      }
    }
  ]
}
```

## 保存建议

### `trend.track`

```json
{
  "type": "trend_tracking_result",
  "suggestedCollection": "trend_tracking_results",
  "data": {}
}
```

### `topic.recommend`

```json
{
  "type": "topic_recommendation",
  "suggestedCollection": "topic_recommendations",
  "data": {}
}
```

## 错误和降级

### 缺少人设

条件：

```text
缺少 savedPersona
```

返回：

```json
{
  "status": "failed",
  "error": {
    "code": "MISSING_CONTEXT",
    "message": "热门追踪需要先保存人设信息。"
  }
}
```

### 工具不可用

条件：

```text
RetrievalTool 未配置或调用失败
```

返回：

```json
{
  "status": "partial_success",
  "warnings": [
    {
      "code": "TOOL_UNAVAILABLE",
      "message": "当前结果基于已有信息生成，部分外部热点数据暂不可用。"
    }
  ]
}
```

## 约束

- 不编造真实小红书笔记数据。
- 没有真实互动指标时，不生成具体点赞、收藏、评论数字。
- 不承诺某个选题一定涨粉。
- 如果使用 mock 数据，必须在 `sources` 或 `warnings` 中体现。
- 输出必须结构化，不能只输出自然语言总结。
- 完整热门追踪结果必须包含 `cardPreview`。
- 前端不得把 `trendSummary.summary`、`trends` 或 `audience` 直接截断后作为初始页卡片摘要。
- 热门追踪初始页首条输入不得返回 `discussionOnly = true`。
- 热门追踪初始页首条输入必须返回完整 `completeAnalysis`。
- 热门追踪聊天页的“总结实时进度 / 保存消息”触发链路不得返回 `discussionOnly = true`。
- 热门追踪聊天页的实时总结结果必须包含可用于刷新历史卡片和概要预览的 `cardPreview`。

## 一期验收标准

- `trend.track` 能在有 `savedPersona` 时返回趋势、需求和选题机会。
- `trend.track` 能在工具不可用时返回 `partial_success`。
- `topic.recommend` 能根据 `trendSnapshot` 输出可点击进入写作的选题。
- 缺少 `savedPersona` 时返回 `MISSING_CONTEXT`。
- 返回中包含可供后端保存的 `savePayload`。
- 新生成的热门追踪记录在完整结构化结果中包含 `cardPreview.discoveryKeywords` 和 `cardPreview.shortTopics`。
- 热门追踪初始页历史卡片优先展示 `cardPreview`，不展示长段摘要。
- 热门追踪初始页首条输入返回 `discussionOnly = false`，且存在完整 `completeAnalysis`。
- `topic.recommend.startWritingInput` 至少包含 `topic`，推荐同时包含 `writingEntrySource`。
- 当前不要求把历史记录跨页面传进内容撰写页。
