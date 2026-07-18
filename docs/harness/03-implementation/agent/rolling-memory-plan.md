# Rolling Memory 设计口径

## 目标

Rolling Memory 是 KOC 在完整长期 Memory 系统之前的一个短期会话记忆模块。

它只解决一件事：

- 在单个 `conversationScope` 内，当对话超过最近 12 条原文窗口后，如何把更早消息压缩成 `conversationSummary`，再和最近原文一起提供给 Agent。

它不是：

- 用户长期偏好系统
- MCP 记忆系统
- 跨场景共享记忆
- 跨草稿历史拼接器

## 核心结构

一期固定采用：

```text
conversationSummary + recentMessages + currentArtifact + required business context
```

含义：

- `conversationSummary`
  - 当前 scope 中，已被 recent window 挤出的较早消息压缩结果
- `recentMessages`
  - 最新 12 条原文消息
- `currentArtifact`
  - 当前场景下最新结构化成果
- `required business context`
  - 例如人设、当前热门结果、当前草稿等业务上下文

## 作用边界

### `conversationSummary`

只记录本次 scope 中对后续对话有持续价值的内容：

- 用户目标
- 已确认事实
- assistant 的阶段性发现
- 用户反馈
- 已接受 / 已否定决策
- 待确认问题
- 当前关注点
- 与 current artifact 相关的必要备注

不记录：

- 长期用户画像
- 场景外偏好
- 完整结构化产物正文
- 逐条聊天复述

### `recentMessages`

始终保留最新 12 条原文，优先级高于 `conversationSummary`。

用途：

- 保住近距离表达
- 保住刚刚发生的修正
- 在 summary 漂移时给模型最后的纠偏依据

### `currentArtifact`

指当前 scope 中最新的结构化成果，不是所有历史成果。

示例：

- 热门追踪：当前 `completeAnalysis`
- 内容撰写：当前 `completeDraft`
- 人设追问：当前正在 refining 的 `personaDraft`

原则：

- `currentArtifact` 不被压进 summary 作为替代
- Agent 看到的是原始 artifact + summary 备注，而不是只看 summary

## 压缩触发规则

一期不做智能选择，采用确定性触发。

### 基本触发

- 当消息离开最近 12 条窗口，且还没有被 summary 覆盖时，触发 summary update

### 强制触发

- 热门追踪保存时
- 热门追踪 `realtime_progress` 总结前
- 即将触达 80 条原文上限前

### 不触发的情况

- 对话还未超过 12 条
- 没有新的未覆盖旧消息
- 只是读取当前记录，没有新增对话

## 压缩方法

Rolling Memory 不是“对 80 条全量反复重总结”。

一期采用增量压缩：

1. 保留旧 `conversationSummary`
2. 找出刚刚离开 recent window 且未被覆盖的消息段
3. 把“旧 summary + 新增待压缩消息 + currentArtifact 备注”交给 summary model
4. 输出新的 `conversationSummary`
5. 更新 `coveredMessageCount`

这样做的目的：

- 避免每次都重喂完整 80 条
- 减少重复计算
- 降低 summary 漂移

## 存储边界

一期原文上限仍然是每个 scope 80 条。

规则：

- 80 条以内，原文可保存、展示、恢复
- 超过 80 条前，必须确保更老原文已经被 `conversationSummary` 覆盖
- 如果 summary 失败且即将丢弃未覆盖原文，不允许静默继续

## 场景规则

### 热门追踪

是一期第一优先场景。

上下文组成：

- 已保存人设
- `conversationSummary`
- 最近 12 条原文
- 当前 `completeAnalysis`

保存后应同时保存：

- `conversationSummary`
- `memoryMeta`
- 当前 raw history window

重新点进旧记录后：

- 继续同一个 `conversationScopeId`
- 共享同一个 80 条上限
- 最近 12 条窗口从旧记录继续往后推

### 内容撰写

上下文组成：

- 已保存人设
- `conversationSummary`
- 最近 12 条原文
- 当前 `completeDraft`

约束：

- 不读取其他历史草稿的结构化内容
- 不把不同 draft record 串起来

### 人设追问

上下文组成：

- 当前已保存人设或当前 personaDraft
- `conversationSummary`
- 最近 12 条原文

约束：

- refining scope 和记忆 scope 只在当前人设对话内有效
- 不把它当长期画像系统

## 冲突优先级

固定优先级：

```text
recentMessages > currentArtifact > conversationSummary
```

含义：

- 最近原文如果修正了 summary，应以最近原文为准
- 当前 artifact 如果与 summary 不一致，应以当前 artifact 为准
- summary 只提供中远距离连续性，不夺权

## 模型与执行方式

一期采用独立 memory model。

当前建议：

- memory summarize model 默认使用智谱清言 / GLM
- 与主生成模型配置分离
- 不可用时允许回退到主模型，但要有明确配置口径

执行方式：

- v1 先走同步

原因：

- 简单
- 结果立即可用
- 方便测量真实延迟成本

## 失败策略

### 普通失败

如果总结失败，但不会立刻造成旧原文丢失：

- 正常返回业务输出
- `summaryStatus` 标 stale 或 rebuild needed

### 危险失败

如果总结失败，且继续对话会导致未覆盖旧消息被 80 条上限挤掉：

- 不允许静默继续
- 必须阻断或引导用户 save / new conversation

## 后续演进位置

后续如果引入完整 Memory 系统：

- Rolling Memory 会退化成短期会话记忆模块
- MCP、长期偏好、跨记录检索会成为更高层能力
- 当前的 `conversationSummary`、`memoryMeta`、`conversationScopeId` 应尽量保持 provider-neutral，便于挂到未来系统上
