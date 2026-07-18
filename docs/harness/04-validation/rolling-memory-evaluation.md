# Rolling Memory 优化前后评测方案

## 目标

本文档定义 Rolling Memory 的优化前后评测口径。它不只检查“功能能不能跑通”，还要回答三个问题：

- 连续对话效果是否真的比现状更好；
- 同步总结是否把响应速度拖慢到不可接受；
- 保存 / 重开 / 失败兜底时，记忆行为是否稳定。

本文档服务于 `add-rolling-memory` 变更的基线采集、改后复测和上线前决策。

## 适用范围

当前一期只覆盖窄义 Agent 会话记忆，不覆盖：

- 用户长期偏好记忆
- MCP / 向量检索
- 跨记录拼接历史草稿
- 前端滚动位置、视图状态等 UI 状态

当前重点场景：

- 热门追踪
- 内容撰写
- 人设追问

其中第一优先级是：

- 热门追踪长对话连续性
- 热门追踪保存后重开连续性

## 评测分层

Rolling Memory 的评测分为四层：

1. 基线评测
2. 改后评测
3. 前后对比
4. 上线决策

统一要求：

- 前后必须使用同一组输入脚本和同一环境
- 指标必须说明采集方法
- 结论必须落到“保留 / 回滚 / 继续实验 / 缩小范围”

## 核心假设

Rolling Memory 的一期假设是：

- 当消息超过最近 12 条原文窗口后，`conversationSummary + recentMessages + currentArtifact` 比“只读最近消息”更能保住上下文连续性；
- 即使增加一次同步总结调用，总体延迟增长仍然可接受；
- 从历史热门记录继续对话时，共享 `conversationScopeId` 和同一 80 条上限，比“重新起一段 80 条”更连贯。

## 固定评测场景

第一批固定评测场景至少包含下面 6 个：

### 1. 热门追踪 13 条连续性

目标：

- 验证第 13 条出现时，第一批被挤出最近窗口的消息是否被正确压缩并继续影响回答。

重点检查：

- 用户已确认方向是否被记住
- 已否定方向是否不会死灰复燃
- Agent 是否还能引用更早轮次的有效结论

### 2. 热门追踪 24 条连续性

目标：

- 验证 summary 多次递进更新后，较早决策是否仍能保留。

重点检查：

- `covered message count` 是否推进正确
- `conversationSummary` 是否发生明显漂移
- 最近 12 条与 summary 冲突时是否以最近原文为准

### 3. 热门追踪 保存后重开

目标：

- 验证保存热门记录后重新点入，是否继续同一 `conversationScope`。

重点检查：

- `conversationScopeId` 是否一致
- `conversationSummary` 是否恢复
- 最近 12 条原文是否从旧窗口继续，而不是从 0 重新算

### 4. 内容撰写多轮改稿

目标：

- 验证 current artifact 与 summary 并存时，当前草稿优先级是否正确。

重点检查：

- 当前 draft 结构是否优先于 summary
- 旧讨论是否仍能提供方向上下文
- 不同 draft 记录之间不会串连

### 5. 总结失败 / stale fallback

目标：

- 验证总结失败时，业务输出仍可返回，但 memory 状态会明确标记。

重点检查：

- 业务输出是否正常
- `summaryStatus` 是否标记为 stale / rebuild needed
- 未到 80 条丢弃边界前是否不阻塞用户

### 6. 80 条上限保护

目标：

- 验证旧消息即将被丢弃时，系统不会静默失忆。

重点检查：

- 在 summary 未覆盖旧消息时，是否阻止继续
- 是否给出 save / new conversation 的明确处理路径

## 指标定义

当前不做全局固定指标表，但 Rolling Memory 第一版至少测以下 5 类指标。

### 1. 速度指标

- `turn_latency_ms`
  - 含义：单轮业务请求从发出到收到最终结果的总耗时
  - 采集：后端接口层打点
- `summary_latency_ms`
  - 含义：一次 memory summarization 模型调用耗时
  - 采集：memory summarize adapter 打点
- `p50 / p95`
  - 含义：同场景多次请求的中位耗时与长尾耗时
  - 采集：至少 5 轮同类样本

### 2. 上下文体积指标

- `agent_input_message_count`
  - 含义：发送给 Agent 的消息条数
  - 采集：context builder 输出日志
- `agent_input_estimated_tokens`
  - 含义：发送给 Agent 的估算输入体积
  - 采集：统一估算函数或 provider token usage
- `summary_covered_count`
  - 含义：summary 已覆盖的历史消息数
  - 采集：`memoryMeta`

### 3. 连续性效果指标

- `confirmed_fact_retention`
  - 是否保住用户已确认事实
- `decision_retention`
  - 是否保住已接受 / 已否定决策
- `focus_retention`
  - 当前关注点是否延续正确
- `artifact_alignment`
  - 当前 structured artifact 是否与回答一致

采集方法：

- 用固定测试脚本人工核对
- 每项按 `pass / partial / fail` 标记
- 必要时补充关键回答摘录

### 4. 恢复一致性指标

- `scope_restore_ok`
  - 重开后 scope 是否一致
- `summary_restore_ok`
  - 重开后 summary 是否恢复
- `window_restore_ok`
  - 重开后最近 12 条窗口是否连续

### 5. 稳定性与兜底指标

- `stale_flag_ok`
  - summary 失败时是否正确标 stale
- `unsafe_discard_block_ok`
  - 80 条上限时是否阻止不安全继续
- `business_output_survives_summary_failure`
  - 总结失败时业务主输出是否仍可用

## 基线采集

基线不是“旧系统随便试一下”，而是固定方法下的正式对照组。

基线要求：

- 在 Rolling Memory 未启用时采集
- 保持同样的场景输入、消息数、用户状态和数据状态
- 保存原始请求、关键响应、耗时和人工评价

基线最少要记录：

- 场景名
- 输入脚本
- 消息轮次
- 当前是否保存 / 重开
- 请求耗时
- 是否丢失早期事实 / 决策
- 是否出现重复提问或上下文断裂

## 改后采集

改后采集必须复用同一脚本，并新增：

- summary 是否触发
- summary 输出摘要
- `summaryStatus`
- `memoryMeta.coveredMessageCount`
- 重开时恢复的 `conversationScopeId`

## 对比原则

对比时不要只写“速度变慢一点，但效果更好了”。

至少要回答：

1. 延迟增加了多少，增加发生在哪一段；
2. 连续性提升体现在哪些具体场景；
3. 是否有场景提升不明显，但增加了复杂度；
4. 是否存在 summary 漂移、恢复错位、80 条边界问题；
5. 是否值得按当前方案上线。

## 通过标准

Rolling Memory 一期建议按下面口径判断是否通过：

- 长对话连续性明显优于现状，至少在 13 条和 24 条案例中能稳定保住早期确认信息
- 热门记录重开后可以延续同一 scope 和记忆状态
- 总结失败不会直接破坏业务主输出
- 80 条上限前不会静默丢失历史记忆
- 延迟增长在可接受范围内，且能够定位增长来自 summary 调用

说明：

- “可接受范围”先不写死全局数值，第一版按基线对比和产品体感共同判断；
- 如果后续形成稳定 SLA，再补具体阈值。

## DevTrace 记录要求

每次正式前后对比都应在 DevTrace 写一条 `optimization-test`。

推荐字段：

```yaml
unit_type: optimization-test
target:
hypothesis:
test_scope:
environment:
method:
metrics:
baseline:
change:
after:
comparison:
decision:
follow_up:
```

要求：

- `metrics` 必须写采集方法
- `baseline` 和 `after` 必须来自同一脚本
- `comparison` 不能只写主观体感
- 测试中出现独立错误时，另建 `test-error`

## 推荐输出物

本次 Rolling Memory 变更至少应产出：

- 本文档
- 对应 OpenSpec 任务项
- 至少 1 条基线 `optimization-test`
- 至少 1 条改后对比 `optimization-test`
- 必要时补充 `test-error`

## 关联文档

- [harness-evaluation-plan.md](./harness-evaluation-plan.md)
- [agent-context-plan.md](../03-implementation/agent/agent-context-plan.md)
- [rolling-memory-plan.md](../03-implementation/agent/rolling-memory-plan.md)
- [rolling-memory-evaluation-template.md](./rolling-memory-evaluation-template.md)
- [rolling-memory-baseline-scripts.md](./rolling-memory-baseline-scripts.md)
