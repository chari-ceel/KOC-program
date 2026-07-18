# KOC Agent 上下文计划

## 背景

当前项目仍处于一期阶段，但已经不是纯规划状态，而是：

- 前端、后端、Agent 三层代码都已存在
- Agent 服务、workflow、mock、检索 fallback、后端 adapter 都已经进入当前服务器 git 仓库
- 文档现在需要反映“当前一期已实现到哪里、哪些仍是预留”，而不是只写未来方案

当前架构分工仍然是：

- 前端负责展示与交互
- 后端负责业务接口、数据库读写、上下文装配和保存
- Agent 负责理解输入、调用 runtime / tools、返回结构化结果

## 当前 Harness 口径

在当前 `docs/` 体系里，人设打造、热门追踪、内容撰写共享同一种 harness 对话场景抽象。

落到上下文层，有三个直接约束：

1. ContextBuilder 负责提供固定业务上下文，不负责做前端结果态判断。
2. 场景是否属于 `discussionOnly` 或结构化结果态，由后端 service 结合 Agent 返回结果判定。
3. context 的职责是帮助 Agent 生成更好的结果，而不是替代后端完成最终结果态归一化。

也就是说：

- `context` 负责“让 Agent 看什么”
- 后端 service 负责“把 Agent 结果归一化成什么”
- 前端负责“如何消费归一化后的结果”

与 harness 主线相关的场景结果体当前统一理解为：

- 人设：`personaDraft`
- 热门：`completeAnalysis`
- 内容：`completeDraft`

因此上下文设计要服务于这三类结构化结果，而不是鼓励前端继续自行猜测成品态。

一期聚焦范围仍然是：

- 人设打造
- 热门追踪
- 内容撰写
- 通用聊天

以下仍然只是预留：

- `context.plan`
- `ContextProviderTool`
- 多 Agent
- 长期记忆
- 多平台

## 当前架构决策

当前一期已经实际采用的是：

```text
固定上下文包方案
```

也就是：

- 后端不做复杂语义理解
- 后端按业务接口和 `taskType` 查询固定数据
- 后端把这些数据装配进 `context`
- Agent 负责消费 `input + context`

这不是“待定方案”，而是当前已经落地在代码里的真实做法。

## 当前一期实际流程

```text
前端发起请求
→ 后端业务接口接收请求
→ 后端 Service 调用 ContextBuilder 装配固定上下文
→ 后端通过 AgentClient 调用 /agent/run
→ Agent 读取 input + context
→ Agent 返回 data / savePayload / warnings / 其他字段
→ 后端按业务逻辑决定是否保存
→ 前端展示结果
```

从 harness 视角看，这条链路在 context 层的含义是：

- ContextBuilder 只负责装配固定上下文
- Agent 基于 `input + context` 生成原始结果
- 后端 service 再把原始结果归一化为 `discussionOnly` 或结构化结果
- 前端不直接根据 context 推导结果态

## 当前已经落地的上下文装配

当前上下文由 [builder.py](../../../../backend/app/adapters/agent/builder.py) 装配。

### `persona.analyze`

当前真实上下文：

```json
{
  "userId": "demo-user",
  "history": []
}
```

说明：

- 这里当前真实字段名是 `history`
- 不是旧文档里常写的 `personaHistory`

### `persona.follow_up`

当前真实上下文：

```json
{
  "baseInfo": {},
  "conversationHistory": []
}
```

### `trend.track`

当前真实上下文：

```json
{
  "savedPersona": {},
  "trendHistory": [],
  "conversationHistory": []
}
```

当前限制：

- `savedPersona` 是关键前置条件
- `trendHistory` 字段名已经有，但 builder 当前仍返回空数组
- 也就是说“趋势历史概念上存在，但实际上还没真正注入 Agent”

### `content.draft`

当前真实上下文：

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

当前没有独立 `build_content_revise_context()`。

当前真实做法是：

- 先走 `build_content_draft_context()`
- 再由 `ContentService` 手动补 `context.currentDraft`

因此真实上下文通常是：

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

## 当前后端主链路的真实状态

当前后端主链路里，调用 Agent 时基本都会显式传：

```json
{
  "runtimeProvider": "model",
  "enableTools": false
}
```

这意味着一期现状是：

- Agent 已具备工具能力
- 但正式业务主链路默认不开工具
- 上下文仍然主要依赖后端固定装配

## 当前一期上下文边界

当前已经明确的边界仍然是：

- 后端是用户业务数据的唯一可信源
- Agent 不直接查业务 Mongo
- Agent 不直接保存业务数据
- Agent 只能理解后端传进来的上下文

这几点已经体现在现有代码和服务器仓库实现里，不再只是原则。

## 当前各任务的一期上下文要求

### `persona.analyze`

当前业务前提：

- `input.baseInfo` 必须存在

当前后端会补：

- `context.userId`
- `context.history`

### `persona.follow_up`

当前业务前提：

- `input.userMessage` 必须存在
- `context.baseInfo` 必须存在
- `context.conversationHistory` 必须存在

### `trend.track`

当前业务前提：

- `context.savedPersona` 必须存在

当前可选但并未真正发挥作用的上下文：

- `trendHistory`
- `conversationHistory`

### `topic.recommend`

Agent 侧前提：

- `context.savedPersona`
- `context.trendSnapshot`

但要注意：

- 当前 Agent 已支持
- 当前后端还没有单独暴露这个业务入口

### `content.draft`

当前业务前提：

- `context.savedPersona` 必须存在
- `context.selectedTopic` 存在，或 `input.topic` 存在

### `content.revise`

当前业务前提：

- `context.currentDraft` 必须存在
- `context.savedPersona` 必须存在
- `input.revisionInstruction` 必须存在

## 当前一期与“第二阶段 / 第三阶段”的关系

### 第一阶段

第一阶段不是未来方案，而是当前已落地状态：

```text
固定上下文包
```

### 第二阶段：`context.plan`

当前仍是预留。

现状：

- `context.plan` 已经在 `RESERVED_TASKS` 中登记
- 但当前走 `/agent/run` 会返回 `UNSUPPORTED_TASK_TYPE`

也就是说：

- 接口名和规划方向已经进入代码
- 但仍不属于一期已实现能力

### 第三阶段：`ContextProviderTool`

当前仍是预留。

现状：

- `/agent/tools` 会返回 `context_provider`，状态为 `reserved`
- 当前并没有真实运行时调用逻辑

## 当前长期记忆状态

一期仍然不实现 Agent 长期记忆。

### 当前真实业务记忆仍由后端负责

包括：

- 已保存人设
- 趋势历史
- 草稿历史
- 已保存草稿

### 当前 Agent 内部只保留轻量运行态信息

例如：

- 当前请求里的 `input`
- 当前请求里的 `context`
- 工具返回结果
- runtime metadata

没有真实长期记忆写入 / 召回链路。

## 当前问题与一期现实差距

1. 上下文字段名和旧文档并不完全一致  
   比如 `persona.analyze` 现在实际是 `history`，不是 `personaHistory`。

2. 趋势历史没有真正进入 Agent  
   后端有趋势历史接口和 Mongo 存储，但 builder 当前仍传空数组。

3. `content.revise` 的上下文装配不够独立  
   现在是草稿上下文 + 手动补字段，不够清晰。

4. `topic.recommend` 处于“Agent 已支持、后端未完全接出”的状态  
   容易让文档看起来比产品现状更完整。

5. 工具能力已经存在，但一期业务主链路默认不用  
   所以当前效果仍然更依赖固定上下文与 mock / model 生成。

## 当前一期建议

在仍然保持一期口径的前提下，下一步更适合做的是：

1. 让 `trendHistory` 真正进入 Agent `context`

2. 明确 `content.revise` 的独立上下文装配函数

3. 后端单独接出 `topic.recommend` 业务接口

4. 在不改变一期边界的前提下，决定哪些正式业务链路允许默认开启工具

5. 保持 `context.plan` 与 `ContextProviderTool` 为预留，不要在一期文档中写成“已实现”

## 当前总结

- 当前项目仍然是一期阶段
- 但已经不是“只有规划没有实现”的阶段
- 当前上下文策略应明确写成：一期固定上下文包已落地，动态上下文仍是预留
- 文档口径应始终区分清楚：
  - 当前代码已实现
  - 当前代码已登记但未启用
  - 未来阶段才会做
# Agent Context 规划

## 当前口径补充

对于接入 Rolling Memory 的业务场景，Agent context 不再只理解为“最近原文消息”。

一期固定上下文结构为：

```text
conversationSummary + recentMessages + currentArtifact + required business context
```

其中：

- `conversationSummary`
  - 后端维护的 scope 级滚动摘要
- `recentMessages`
  - 最新 12 条原文消息
- `currentArtifact`
  - 当前 scope 中最新结构化结果
- `required business context`
  - 该业务场景本来就需要的上下文，例如已保存人设

## 优先级

当这些上下文彼此不一致时，固定按下面顺序解释：

```text
recentMessages > currentArtifact > conversationSummary
```

这意味着：

- summary 只负责中远距离连续性
- 最近原文负责覆盖最新修正
- 当前结构化成果负责当前业务对象本身

## 一期不做的事情

- 不让 Agent 自主选择是否读取 summary
- 不做 MCP memory retrieval
- 不做用户长期偏好注入
- 不做跨 record 的草稿历史拼接
