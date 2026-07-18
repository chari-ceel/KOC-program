# Harness 场景返回协议

## 目标与范围

本文档定义 harness 体系下的场景级返回协议。

当前先覆盖两块：

- 热门追踪的返回结构
- 内容撰写的 suggestions 结构

本文档是对 [harness-overview.md](../../01-foundation/harness-overview.md) 的下钻，不重复解释总纲，只定义更细的场景协议。

当前不纳入本轮细化的内容：

- 三页加载文案
- 热门或人设场景的 suggestions

## 通用返回壳约定

人设打造、热门追踪与内容撰写的后端对前端返回，统一遵循以下壳层语义：

```json
{
  "discussionOnly": false,
  "structuredResult": {},
  "text": "前端普通对话直接展示文本",
  "raw": {}
}
```

字段语义：

- `discussionOnly`
  - `true` 表示当前只是讨论、澄清、解释、追问
  - `false` 表示当前已经形成结构化结果
  - 热门追踪初始页和内容撰写初始页的首条业务输入必须返回 `false`
- `structuredResult`
  - 当前场景的结构化结果体
  - 场景不同，内部 schema 不同
- `text`
  - 普通 assistant 对话可直接展示的文本
- `raw`
  - Agent 原始结果，供兼容和排障使用

落到具体场景时：

- 人设打造把 `structuredResult` 具体化为 `personaDraft` 或初版 persona 结构
- 热门追踪把 `structuredResult` 具体化为 `completeAnalysis`
- 内容撰写把 `structuredResult` 具体化为 `completeDraft`

前端消费原则：

- 只要 `discussionOnly = true`，按普通对话渲染
- 只要存在结构化结果，就进入结构化渲染
- 是否可保存不再由前端单独猜测，默认与结构化结果同步
- 保存按钮只能跟随结构化结果出现；讨论态消息下不显示保存动作

### 运行态 Agent 状态反馈边界

在 harness 里，以下内容统一归类为 `Agent 状态反馈`：

- 生成中
- 停止输出
- 错误提示

边界规则：

- 它们不属于 `text` 对应的普通 assistant 正文
- 它们不属于 `structuredResult`
- 它们不属于保存成功 / 删除成功这类页面级反馈
- `discussionOnly` 与 `structuredResult` 只定义成功返回后的正文消费方式，不定义前端运行态提示样式
- 生成中与用户手动停止由前端本地会话状态驱动
- 请求失败应由前端转译为 `Agent 状态反馈`，不应简单追加为可保存的 assistant 文本
- 如果未来后端需要显式返回运行态状态枚举，应扩展专门字段，不应复用 `text` 冒充状态提示

## 热门追踪返回协议

## 人设打造返回协议

### 结果态

人设打造场景同样只使用两层结果态：

- `discussionOnly`
- `personaDraft` / 初版 persona 结构化结果

规则：

- 人设打造初始页首条业务输入必须直接进入结构化结果主路径，不允许先返回讨论态
- 人设聊天页后续追问默认是讨论态
- 只有当 Agent 明确判断“本轮需要重新汇总当前人设”时，才再次进入结构化结果态
- 对人设场景而言，完整 `personaDraft` 优先决定结构化结果态；`nextQuestions` 可以作为后续继续完善问题与结构化结果同次返回，不阻断保存

### 人设场景保存动作约束

- 只要当前消息属于讨论态，就不显示保存按钮
- 只有结构化人设结果出现时，才允许显示保存按钮
- 这条规则适用于：
  - 初始页首条 `persona.analyze` 结果
  - 后续 `persona.follow_up` 中再次进入结构化阶段的结果

### 人设场景职责边界

后端负责：

- 判断当前轮次属于讨论态还是结构化人设态
- 识别首轮输入必须强制结构化
- 识别后续追问里哪些只是解释、澄清、补充偏好
- 识别后续追问里哪些已经构成“重新汇总一版人设”的请求

前端负责：

- 讨论态按普通对话渲染
- 结构化态按人设草稿/人设结果渲染
- 无论讨论态还是结构化态，只要后端返回 `nextQuestions`，前端都应作为正文的一部分展示出来，避免出现“我想再问几个问题”但问题列表缺失
- 只在结构化态消息下显示保存按钮

补充说明：

- 如果本轮 reply 明确表达“还需要继续了解”“还要再确认几个点”，且 `personaDraft` 不完整，默认不应同时把这条消息当成新的结构化保存节点
- 如果本轮已经形成完整 `personaDraft`，则允许同时返回 `nextQuestions`；这些问题表示可选继续完善，不表示当前结果不可保存
- 前端不能仅因为响应体里存在零散 `personaDraft` 字段就推断“可以保存”；是否属于结构化态，应遵循后端和场景协议的明确判定
- `persona.description` 与 `personaDraft.persona.description` 必须是可直接展示的账号定位摘要，不得写成第三人称人物介绍
- 这两个描述字段禁止出现“她”“他”“TA”“用户”这类第三人称或泛指称呼

### 人设 `personaDraft` 完整标准

用于进入结构化态和显示保存按钮的 `personaDraft` 至少应覆盖：

- `persona.name` 或 `persona.description`
- `niche.primary` 或 `niche.secondary`
- `audience`
- `contentStyle`

只有零散 `personaDraft` 字段、空对象或阶段性猜测时，仍应视为讨论态。

## 热门追踪返回协议

### 结果态

热门追踪场景只使用两层结果态：

- `discussionOnly`
- `completeAnalysis`

不单独定义：

- `canSave`

规则：

- `completeAnalysis` 存在，即允许保存
- `completeAnalysis` 不存在，即处于讨论态
- 热门追踪初始页首条业务输入必须直接进入 `completeAnalysis` 主路径

### `completeAnalysis` 最低完整标准

一份完整热门分析至少同时包含：

- `trackName`
- `trends`
- `audience`
- `topics` 至少 1 条

字段说明：

- `trackName`
  - 当前追踪主题或赛道名称
- `trends`
  - 热点趋势总结
- `audience`
  - 受众需求总结
- `topics`
  - 可继续进入内容撰写的选题列表
- `cardPreview`
  - 热门追踪初始页历史卡片使用的轻量预览字段
  - 由 Agent 在完整分析同次输出
  - 不由前端截断长摘要生成

### 讨论态示例

```json
{
  "discussionOnly": true,
  "completeAnalysis": null,
  "text": "这个方向适合你，但我建议先缩小到大学生成长里的自律提升，再做更具体的热点分析。",
  "raw": {
    "reply": "这个方向适合你，但我建议先缩小到大学生成长里的自律提升，再做更具体的热点分析。",
    "isReadyToSave": false
  }
}
```

这种情况表示：

- 当前只是解释或引导
- 前端只展示文本
- 不进入结构化卡片渲染

### 完整分析态示例

```json
{
  "discussionOnly": false,
  "completeAnalysis": {
    "trackName": "大学生成长",
    "trends": "低成本自律、早八效率、宿舍健身内容持续升温",
    "audience": "用户更想要低门槛、可立即执行、能短期看到反馈的方法",
    "topics": [
      "大学生如何低成本重启自律",
      "早八党5分钟出门流程",
      "宿舍党一周轻运动计划"
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

这种情况表示：

- 当前已经形成完整热门分析
- 前端展示结构化分析块
- 前端允许保存

### 后端责任

热门追踪场景里，是否属于完整分析态由后端负责判定，不由前端猜测。

后端负责：

- 识别是否只是讨论态
- 识别是否已经形成完整分析
- 归一化 `completeAnalysis`
- 校验并透传 `completeAnalysis.cardPreview`
- 产出 `text`
- 保留 `raw`

前端只负责：

- 渲染 `discussionOnly`
- 渲染 `completeAnalysis`
- 在历史卡片中优先渲染 `completeAnalysis.cardPreview`
- 在存在 `completeAnalysis` 时提供保存动作

### `cardPreview` 协议

`cardPreview` 是完整结构化结果的一部分，跟随 `completeAnalysis` 同步生成、保存和恢复。

字段结构：

```json
{
  "discoveryKeywords": ["平价替代", "新手化妆", "通勤妆"],
  "shortTopics": ["新手通勤妆", "百元彩妆清单", "底妆避坑"]
}
```

职责边界：

- Agent 负责在生成完整热门追踪结果时同步生成 `cardPreview`。
- 后端负责归一化、保存和透传 `cardPreview`。
- 前端负责在热门追踪初始页历史卡片中展示 `cardPreview`。
- 前端不得把 `trends`、`audience`、`trendSummary.summary` 或其他长文本截断后当作卡片摘要。
- 热门追踪初始页首条输入必须直接命中这条完整结构化链路，不允许先返回讨论态。

生成约束：

- `discoveryKeywords` 输出 2-3 条趋势关键词。
- `shortTopics` 输出 2-3 条短选题。
- 单条必须是短语，不应是完整解释句。
- 单条建议 4-10 个中文字符，最多不超过 14 个中文字符。

旧数据兼容：

- 历史记录缺少 `cardPreview` 时，前端可以从既有 `trends` 和 `topics` 做临时兜底展示。
- 兜底只服务旧数据展示，不改变新结果必须由 Agent 输出 `cardPreview` 的主路径。
- 兜底结果仍需限制为 2-3 个短语，不应展示长段摘要。

### 与当前代码的映射

当前热门页已按本协议消费：

- 后端返回 `discussionOnly`
- 后端返回 `completeAnalysis`
- 前端基于 `completeAnalysis` 决定是否进入结构化渲染与保存链路
- `text` 与 `raw` 继续保留用于普通对话展示与排障
- 新生成结果应把 `cardPreview` 作为 `completeAnalysis` 的正式字段保存和恢复

## 内容撰写 Card Preview 协议

内容撰写场景的 `cardPreview` 是完整草稿的一部分，用于内容撰写初始页草稿卡片。

补充要求：

- 内容撰写初始页首条业务输入必须直接进入完整 `completeDraft` 主路径，不允许先返回讨论态。

字段结构：

```json
{
  "keywords": ["考证避坑", "自律补救", "低成本学习"]
}
```

职责边界：

- Agent 负责在生成完整 `completeDraft` 时同步生成 `cardPreview`。
- 后端负责归一化、保存和透传 `completeDraft.cardPreview`。
- 前端负责在内容撰写初始页草稿卡片中展示 `cardPreview.keywords`。
- 前端草稿卡片主标题应展示已保存笔记标题，后端保存记录时应保证 `title` 与 `structured.noteTitle` 一致。
- 前端不得把 `intro`、`hook`、`body` 或其他长正文截断后当作卡片摘要。

生成约束：

- `keywords` 输出 2-3 条。
- 单条必须是短语，不应是完整解释句。
- 单条建议 4-10 个中文字符，最多不超过 14 个中文字符。
- 优先覆盖选题角度、内容痛点或可复用结构，不重复泛泛标签。

旧数据兼容：

- 历史草稿缺少 `cardPreview` 时，前端可以从 `title`、`tags` 或既有短字段做临时兜底。
- 兜底只服务旧数据展示，不改变新草稿必须由 Agent 输出 `cardPreview` 的主路径。
- 兜底结果仍需限制为 2-3 个短语，不应展示长段正文摘要。

## 内容撰写 Suggestions 协议

### 定位

内容页 suggestions 的正式定位是：

```text
系统推测用户可能提出的修改建议
```

它不是：

- 前端静态规则按钮
- 系统命令
- 强制用户执行的下一步动作

它是：

- 基于当前完整草稿推测出的下一步改写方向

### 返回前提

Suggestions 只在以下条件下返回：

- 当前返回的是完整 `completeDraft`

不返回 suggestions 的情况：

- `discussionOnly = true`
- draft 还不完整
- 当前只是继续讨论方向

### 字段结构

```json
{
  "label": "把标题改得更像搜索词",
  "instruction": "请把标题改得更像小红书搜索词，保留大学生和低成本自律两个关键词。",
  "intent": "title_optimize"
}
```

字段说明：

- `label`
  - 给前端按钮直接展示
  - 应简短、易点击
- `instruction`
  - 用户点击该 suggestion 后，直接作为 revise 指令发送
  - 应足够具体，避免前端二次拼装
- `intent`
  - suggestion 类型
  - 供系统识别、统计、排序或后续 A/B 使用

### 返回示例

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
  "suggestions": [
    {
      "label": "把标题改得更像搜索词",
      "instruction": "请把标题改得更像小红书搜索词，保留大学生和低成本自律两个关键词。",
      "intent": "title_optimize"
    },
    {
      "label": "开头更强一点",
      "instruction": "请把开头改得更抓人，先抛出一个大学生很容易共鸣的具体场景。",
      "intent": "intro_optimize"
    },
    {
      "label": "补充更可执行步骤",
      "instruction": "请把正文补充成更可照做的步骤清单，每一步再具体一点。",
      "intent": "body_expand"
    }
  ],
  "text": "推荐标题：大学生怎么低成本变自律",
  "raw": {}
}
```

### 前端消费规则

前端收到 suggestions 后：

- 直接渲染为 chips / 按钮
- 点击某一项时，直接把该项 `instruction` 作为 revise 输入发出
- 前端不再根据当前 draft 自己推导建议文案

### 后端与 Agent 责任

建议项的内容生成由 Agent 负责，后端负责：

- 透传或归一化 suggestions
- 确保 suggestions 只出现在完整 draft 场景

### 与当前代码的映射

当前内容页已按本协议消费：

- suggestions 由 Agent / 后端返回
- 前端直接渲染为 chips / 按钮
- 点击后直接把 `instruction` 作为 revise 指令发送

当前仍保留的过渡兼容仅在 draft 字段层：

- `intro` / `hook`
- `draft` / `revisedDraft`
- `raw.draft` / `raw.revisedDraft`

## 当前不纳入本轮的内容

以下内容当前不在本篇协议中细化：

- 人设统一返回壳字段细节
- 人设保存链路
- 热门页 suggestions
- 人设页 suggestions
- 三页加载提示文案

## 关联文档

- [harness-overview.md](../../01-foundation/harness-overview.md)
- [agent-api-contract.md](./agent-api-contract.md)
- [frontend-backend-agent-handoff.md](./frontend-backend-agent-handoff.md)
