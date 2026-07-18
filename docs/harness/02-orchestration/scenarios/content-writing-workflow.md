# 内容撰写 Workflow

## 目标

内容撰写 workflow 用于帮助用户基于人设和选题生成小红书图文笔记草稿，并支持后续对话优化。

一期对应两个任务：

```text
content.draft
content.revise
```

一期只支持：

```text
platform = xiaohongshu
contentType = image_text_note
```

## 输入边界

### `content.draft`

必需 `input`：

```json
{
  "topic": "大学生第一次考证最容易踩的 5 个坑",
  "userInstruction": "语气真实一点，适合新手收藏"
}
```

必需 `context`：

```json
{
  "savedPersona": {},
  "selectedTopic": {}
}
```

可选 `context`：

```json
{
  "writingEntrySource": {
    "sourceType": "manual_input",
    "inputText": "大学生第一次考证最容易踩的 5 个坑"
  },
  "latestTrendSnapshot": {},
  "draftHistory": [],
  "conversationHistory": []
}
```

说明：

- `selectedTopic` 表达当前进入写作的选题
- `writingEntrySource` 表达当前草稿来自哪个页面入口
- `draftHistory`、`conversationHistory` 接口继续保留，但当前不作为跨页面联动依赖

### 内容撰写初始页首条输入约束

- 当用户位于内容撰写初始页，且当前还没有有效内容草稿结果时，第一条业务输入必须直接产出完整结构化草稿。
- 这里的“第一条业务输入”包括简短选题、口吻偏好、表达要求、写作方向描述，不要求用户必须显式说“生成完整笔记”或“给我最终版”。
- 该轮后端除了设置强制完整草稿选项外，还应把用户原始输入包装成一段“请直接输出完整草稿”的明确任务文案，再发送给 Agent。
- 该轮返回必须满足：
  - `discussionOnly = false`
  - `completeDraft` 存在
  - `raw.isReadyToSave = true`
  - `completeDraft.cardPreview` 存在
- 只有进入后续草稿对话或改稿对话后，才允许根据用户意图返回讨论态。

### `content.revise`

必需 `input`：

```json
{
  "revisionInstruction": "标题更吸引人一点，增加真实经历"
}
```

必需 `context`：

```json
{
  "currentDraft": {},
  "savedPersona": {}
}
```

可选 `context`：

```json
{
  "latestTrendSnapshot": {}
}
```

## `content.draft` 处理流程

```text
1. 校验 savedPersona 是否存在。
2. 校验 selectedTopic 或 input.topic 是否存在。
3. 读取用户人设：
   - persona
   - niche
   - audience
   - contentStyle
4. 读取选题信息：
   - title
   - angle
   - fitReason
   - audienceNeed
5. 读取 latestTrendSnapshot，可选。
6. 生成标题候选 titleOptions。
7. 选择 selectedTitle。
8. 生成开头钩子 hook。
9. 生成正文 body。
10. 生成结尾互动 ending。
11. 生成 tags。
12. 生成 coverSuggestion。
13. 生成 imageTextStructure。
14. 生成 videoSuggestion，作为扩展建议。
15. 同步生成 cardPreview，用于内容撰写初始页草稿卡片。
16. 如果当前是内容撰写初始页首条输入，强制本轮落到完整结构化草稿主路径。
17. 返回 draft、cardPreview 和 savePayload。
```

## `content.revise` 处理流程

```text
1. 校验 currentDraft 是否存在。
2. 校验 revisionInstruction 是否存在。
3. 读取 savedPersona，保证修改后仍符合人设。
4. 判断用户修改意图：
   - 优化标题
   - 增加真实经历
   - 改语气
   - 缩短正文
   - 增加标签
   - 增加互动
5. 修改对应字段。
6. 返回 revisedDraft。
7. 返回 changes，说明改了哪些字段以及原因。
8. 返回 savePayload。
```

## 工具调用

一期默认不强制调用外部工具。

可选使用：

```text
latestTrendSnapshot
```

说明：

- 内容撰写主要依赖人设、选题和已有趋势快照。
- 如果需要进一步查热点，应该由热门追踪模块先完成，不建议内容撰写临时发起大量检索。
- 后续如果需要补充平台规则或风险检查，可以调用 `RetrievalTool` 查询 `official_rule_store`。

## 输出结构

### `content.draft`

```json
{
  "draft": {
    "titleOptions": [
      "第一次考证，我最想提前知道的 5 件事",
      "大学生考证前一定要避开的 5 个坑"
    ],
    "selectedTitle": "第一次考证，我最想提前知道的 5 件事",
    "hook": "如果你也是第一次准备考证，先别急着买一堆资料。",
    "body": "正文内容",
    "ending": "你第一次考证最担心哪一步？可以留言，我整理下一篇。",
    "tags": ["#大学生成长", "#考证规划", "#学习方法"],
    "coverSuggestion": {
      "mainText": "第一次考证避坑清单",
      "layout": "大标题 + 5 个关键词",
      "visualStyle": "清爽、真实、适合收藏"
    },
    "imageTextStructure": [
      "封面：第一次考证避坑清单",
      "图 1：为什么新手容易踩坑",
      "图 2-6：五个常见坑",
      "图 7：总结和互动提问"
    ],
    "videoSuggestion": {
      "opening": "3 秒说出痛点：第一次考证别急着买资料",
      "shots": ["桌面资料", "计划表", "复盘笔记"],
      "note": "一期主做图文，视频建议作为扩展输出"
    },
    "cardPreview": {
      "keywords": ["考证避坑", "资料选择", "新手规划"]
    }
  }
}
```

### `cardPreview`

`cardPreview` 是 Agent 在生成完整内容草稿时同步输出的卡片预览字段，用于内容撰写初始页草稿卡片。

它不是：

- 前端截断 `hook`、`intro` 或 `body` 得到的摘要
- 后端二次总结草稿得到的新文本
- 对完整草稿内容的替代

它是：

- 草稿卡片的快速扫读关键词
- 用户从草稿箱恢复写作时的轻量线索
- 与完整草稿同源生成的结构化展示字段

补充约束：

- 内容撰写草稿卡片的主标题必须使用已保存笔记标题。
- 对应保存记录里的 `title` 应与 `structured.noteTitle` 保持一致。
- 用户主动输入的初始主题只作为 `draftSource` / 改稿上下文保留，不应继续占用草稿卡片标题。

字段规则：

- `keywords` 输出 2-3 条。
- 单条应为短语，不应为完整解释句。
- 单条建议 4-10 个中文字符，最多不超过 14 个中文字符。
- 优先覆盖选题角度、内容痛点或可复用结构，不重复泛泛标签。

合格示例：

```json
{
  "keywords": ["考证避坑", "自律补救", "低成本学习"]
}
```

不合格示例：

```json
{
  "keywords": ["这篇文章主要讲大学生如何更好地准备考证"]
}
```

### `content.revise`

```json
{
  "revisedDraft": {
    "titleOptions": [],
    "selectedTitle": "标题",
    "hook": "开头钩子",
    "body": "正文内容",
    "tags": []
  },
  "changes": [
    {
      "field": "titleOptions",
      "reason": "增强痛点和点击动机"
    }
  ]
}
```

## 保存建议

### `content.draft`

```json
{
  "type": "content_draft",
  "suggestedCollection": "content_drafts",
  "data": {
    "draftSource": {
      "sourceType": "hot_tracking",
      "trackId": "track_xxx",
      "trackName": "大学生成长赛道",
      "topicId": "topic_xxx",
      "topicTitle": "大学生第一次考证前，我最想知道的 5 件事"
    }
  }
}
```

### `content.revise`

```json
{
  "type": "content_revision",
  "suggestedCollection": "content_revisions",
  "data": {}
}
```

## 错误和降级

### 缺少人设或选题

条件：

```text
缺少 savedPersona 或 selectedTopic/input.topic
```

返回：

```json
{
  "status": "failed",
  "error": {
    "code": "MISSING_CONTEXT",
    "message": "内容撰写需要先完成人设打造，并选择一个选题。"
  }
}
```

### 修改指令为空

条件：

```text
content.revise 缺少 revisionInstruction
```

返回：

```json
{
  "status": "failed",
  "error": {
    "code": "INVALID_REQUEST",
    "message": "缺少草稿修改意见。"
  }
}
```

## 约束

- 一期只生成小红书图文笔记。
- 不生成抖音视频脚本或 B站长视频大纲。
- 不承诺涨粉效果。
- 不编造真实数据来源。
- 不输出违反平台规则的极端功效、虚假宣传或诱导导流表达。
- 输出必须结构化，不能只输出一整段自然语言。
- 完整内容草稿必须包含 `cardPreview`。
- 前端不得把 `intro`、`hook` 或 `body` 直接截断后作为草稿卡片摘要。
- 内容撰写初始页首条输入不得返回 `discussionOnly = true`。
- 内容撰写初始页首条输入必须返回完整 `completeDraft`。

## 一期验收标准

- `content.draft` 能根据人设和选题生成完整小红书图文结构。
- `content.draft` 输出包括标题、钩子、正文、结尾、标签、封面建议、图文结构和视频建议。
- `content.revise` 能根据用户修改意见更新草稿。
- `content.revise` 能返回 `changes` 说明改动原因。
- 缺少人设或选题时返回 `MISSING_CONTEXT`。
- 返回中包含可供后端保存的 `savePayload`。
- 新生成的内容草稿在完整结构化结果中包含 `cardPreview.keywords`。
- 内容撰写初始页草稿卡片优先展示 `cardPreview`，不展示长段正文摘要。
- 内容撰写初始页首条输入返回 `discussionOnly = false`，且存在完整 `completeDraft`。
- 页面联动进入内容撰写时，可带 `writingEntrySource`。
- 新生成草稿保存后，应能保留 `draftSource` 作为草稿业务来源。
- 当前不要求跨页面传递 `draftHistory` 或 `conversationHistory`。
