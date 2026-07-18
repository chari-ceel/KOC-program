# Rolling Memory 评测记录模板

## 使用说明

本模板用于记录 Rolling Memory 的单次正式评测结果。

适用时机：

- 实现前 baseline
- 实现后 after
- 前后对比 comparison

建议规则：

- 同一轮正式实验尽量使用同一份模板
- `baseline` 与 `after` 必须使用同一脚本、同一环境、同一场景口径
- 定量指标直接填数值
- 定性指标统一填 `pass / partial / fail`

## 1. 基本信息

| 字段 | 填写内容 |
|---|---|
| 评测名称 | 例如：Rolling Memory baseline / after / comparison |
| 日期 |  |
| 执行人 |  |
| 环境 | 本地 / Docker / 测试环境 |
| 场景 | trend / content / persona |
| 子场景 | 13-message / 24-message / reopen / stale-fallback / 80-limit |
| 模型配置 | 主模型 + memory model |
| 代码版本 | commit / branch / 说明 |
| 数据前置状态 | 是否有已保存人设、已保存趋势记录、当前草稿等 |

## 2. 测试目标

| 字段 | 填写内容 |
|---|---|
| target | 本次要验证的对象 |
| hypothesis | 本次假设 |
| test_scope | 本次范围 |
| success_criteria | 本次通过标准 |

## 3. 输入脚本

### 3.1 固定输入

| 轮次 | 用户输入 | 备注 |
|---|---|---|
| 1 |  |  |
| 2 |  |  |
| 3 |  |  |
| 4 |  |  |
| 5 |  |  |
| 6 |  |  |
| 7 |  |  |
| 8 |  |  |
| 9 |  |  |
| 10 |  |  |
| 11 |  |  |
| 12 |  |  |
| 13 |  |  |

如为 24 条或更长场景，继续补充。

### 3.2 关键埋点

| 类型 | 内容 | 用途 |
|---|---|---|
| confirmed fact |  | 验证事实保留 |
| accepted decision |  | 验证接受决策保留 |
| rejected decision |  | 验证否定决策不会复活 |
| latest focus |  | 验证当前焦点延续 |
| current artifact |  | 验证 artifact 优先级 |

## 4. 自动指标记录

| 指标 | 数值 | 采集方法 | 备注 |
|---|---:|---|---|
| turn_latency_ms |  | 后端接口打点 |  |
| summary_latency_ms |  | summarize adapter 打点 | 无 summary 时填 N/A |
| turn_latency_p50_ms |  | 同脚本多次运行统计 |  |
| turn_latency_p95_ms |  | 同脚本多次运行统计 |  |
| agent_input_message_count |  | context builder 统计 |  |
| agent_input_estimated_tokens |  | usage 或估算函数 |  |
| summary_covered_count |  | `memoryMeta.coveredMessageCount` |  |
| summary_status |  | `fresh / stale / rebuild_needed` |  |
| scope_id_same_after_restore |  | restore 校验 | 仅重开场景填写 |

## 5. 效果判分

| 指标 | 结果 | 证据 | 备注 |
|---|---|---|---|
| confirmed_fact_retention | pass / partial / fail |  |  |
| decision_retention | pass / partial / fail |  |  |
| focus_retention | pass / partial / fail |  |  |
| artifact_alignment | pass / partial / fail |  |  |
| scope_restore_ok | pass / partial / fail |  | 非重开场景填 N/A |
| summary_restore_ok | pass / partial / fail |  | 非重开场景填 N/A |
| window_restore_ok | pass / partial / fail |  | 非重开场景填 N/A |
| stale_flag_ok | pass / partial / fail |  | 非失败场景填 N/A |
| business_output_survives_summary_failure | pass / partial / fail |  | 非失败场景填 N/A |
| unsafe_discard_block_ok | pass / partial / fail |  | 非 80 条场景填 N/A |

## 6. 关键证据摘录

### 6.1 关键请求

```text
填请求摘要、日志片段或 payload 摘要
```

### 6.2 关键响应

```text
填关键回答、summary 摘要或恢复结果
```

### 6.3 关键日志

```text
填 latency、summary status、restore、coverage 等日志
```

## 7. baseline / after / comparison

### 7.1 baseline

| 项目 | 内容 |
|---|---|
| baseline_behavior |  |
| baseline_risks |  |
| baseline_latency_summary |  |
| baseline_continuity_summary |  |

### 7.2 after

| 项目 | 内容 |
|---|---|
| after_behavior |  |
| after_risks |  |
| after_latency_summary |  |
| after_continuity_summary |  |

### 7.3 comparison

| 对比项 | baseline | after | 结论 |
|---|---|---|---|
| turn latency |  |  |  |
| summary latency |  |  |  |
| input size |  |  |  |
| confirmed fact retention |  |  |  |
| decision retention |  |  |  |
| focus retention |  |  |  |
| artifact alignment |  |  |  |
| reopen consistency |  |  |  |
| failure containment |  |  |  |

## 8. 结论

| 字段 | 填写内容 |
|---|---|
| decision | 保留 / 回滚 / 继续实验 / 缩小范围 |
| reason |  |
| rollout_suggestion | 例如：仅先开热门追踪 |
| follow_up | 下一步动作 |

## 9. DevTrace 映射

如需写入 DevTrace `optimization-test`，可直接映射：

```yaml
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

建议：

- 文档模板用于详细填写
- DevTrace TraceUnit 用于沉淀结果摘要与决策
