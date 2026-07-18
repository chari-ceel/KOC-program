# Rolling Memory 第一批 Baseline 测试脚本

## 目标

本文档定义 Rolling Memory 第一批 baseline / after 复测共用的固定输入脚本。

用途：

- 实现前采基线
- 实现后按同脚本复测
- 前后对比时避免“不是同一道题”

统一要求：

- `baseline` 与 `after` 必须复用同一脚本
- 除非明确说明，否则不要临时改写输入
- 每条脚本都要记录对应场景、目标、关键埋点和判分重点

## 脚本 1：热门追踪 13 条连续性

### 场景

- `trend`
- 新建热门追踪对话

### 目标

- 验证第 13 条时，超出 recent 12 窗口后的早期事实与决策是否仍能影响回答

### 前置条件

- 用户已登录
- 已存在一个可用人设
- 当前无旧热门记录干扰

### 固定输入

| 轮次 | 用户输入 | 埋点 |
|---|---|---|
| 1 | 我想做一个面向大学新生的成长类账号，先帮我判断热门追踪方向。 | goal |
| 2 | 先记住，我不做考研，也不做职场，只做大一到大二的校园成长。 | confirmed fact |
| 3 | 我更想从低成本自律、宿舍关系、社团选择这几个方向找机会。 | focus |
| 4 | 你先别给我泛泛建议，我更关心哪些方向最近更容易出爆点。 | focus |
| 5 | 还有一个前提，我希望内容偏女生视角，但不要走情绪宣泄路线。 | confirmed fact |
| 6 | 如果必须取舍，优先保留低成本自律，先放掉宿舍关系。 | accepted decision |
| 7 | 社团选择这个点我有点犹豫，你先不要把它当主方向。 | rejected / pending |
| 8 | 你可以先告诉我，低成本自律里更适合追哪些子话题。 | focus |
| 9 | 我希望选题更像能涨粉的搜索词，不要太鸡汤。 | confirmed fact |
| 10 | 如果你觉得有必要，可以顺便比较一下早八、自习室、时间管理这几个点。 | branch |
| 11 | 但请记住，我现在的核心还是大一女生、低成本自律、搜索感强。 | reinforcement |
| 12 | 先不要展开社团话题。 | rejected decision |
| 13 | 现在基于我们前面的限制，直接给我一个你认为最值得追的热门方向，并解释为什么。 | validation |

### 重点判分

- `confirmed_fact_retention`
- `decision_retention`
- `focus_retention`

### 通过关注点

- 回答中不应重新把考研、职场当主方向
- 回答中不应把社团选择错误抬成主线
- 回答应体现“大一女生 + 低成本自律 + 搜索感强”

## 脚本 2：热门追踪 24 条连续性

### 场景

- `trend`
- 同一条热门追踪连续深入

### 目标

- 验证经过多轮滚动后，summary 是否漂移，较早决策是否仍稳定保留

### 前置条件

- 用户已登录
- 已存在一个可用人设

### 固定输入

前 13 轮复用“脚本 1”，然后继续：

| 轮次 | 用户输入 | 埋点 |
|---|---|---|
| 14 | 这个方向可以，但不要做那种纯打卡模板，我怕内容太同质化。 | rejected decision |
| 15 | 你换个角度，想想哪些话题更像“新生刚开学就会搜”的问题。 | focus |
| 16 | 我接受“早八起床困难”这个切口，但不要把它写成鸡血型励志。 | accepted decision |
| 17 | 先排除“逆袭”“蜕变”这种大词，我要更具体的痛点表达。 | rejected decision |
| 18 | 还有，我不想过多讲学习方法论，更想讲生活场景里的执行难点。 | confirmed fact |
| 19 | 比如起床、洗衣、排队、自习室占座、晚上拖延这种。 | detail |
| 20 | 你先比较一下“起床困难”和“晚上拖延”，哪个更值得追。 | branch |
| 21 | 如果只能选一个，我更偏向晚上拖延，因为更容易写具体场景。 | accepted decision |
| 22 | 但你要警惕别把内容写成情感安慰，我还是要搜索感和方法感。 | confirmed fact |
| 23 | 现在你忘掉那些被我否掉的方向，再重新收束一次。 | validation |
| 24 | 请直接总结：当前最优热门方向、目标人群、表达边界、不要碰的方向。 | final validation |

### 重点判分

- `confirmed_fact_retention`
- `decision_retention`
- `focus_retention`
- `summary_covered_count`

### 通过关注点

- 回答能保留前半段约束，不因轮次变长而回到泛方向
- 回答应体现“晚上拖延优先于起床困难”
- 回答应保留“不鸡血、不考研、不情绪宣泄、不大词”

## 脚本 3：热门追踪 保存后重开

### 场景

- `trend`
- 保存后从历史记录重新点入

### 目标

- 验证保存 / 重开 / 续聊时是否共享同一 `conversationScopeId` 和记忆状态

### 前置条件

- 用户已登录
- 已完成至少 12 轮热门对话并已保存

### 固定步骤

| 步骤 | 操作 | 关注点 |
|---|---|---|
| 1 | 完成一轮不少于 12 条的热门追踪对话 | 构造已有上下文 |
| 2 | 保存当前热门记录 | 保存 memory snapshot |
| 3 | 离开当前记录，回到历史列表 | 触发恢复路径 |
| 4 | 从历史中重新点进刚保存的记录 | restore |
| 5 | 输入：基于我们刚才定下来的边界，再给我 3 个更像搜索词的细化选题。 | continuity |

### 重点判分

- `scope_restore_ok`
- `summary_restore_ok`
- `window_restore_ok`
- `focus_retention`

### 通过关注点

- 重开后不应像新会话一样失忆
- 回答应延续之前的方向边界
- 请求中应继续使用原 scope

## 脚本 4：内容撰写多轮改稿

### 场景

- `content`
- 同一 draft 多轮 revise

### 目标

- 验证 `currentArtifact` 优先于 `conversationSummary`

### 前置条件

- 用户已登录
- 已存在可用人设
- 已生成第一版 draft

### 固定输入

| 轮次 | 用户输入 | 埋点 |
|---|---|---|
| 1 | 帮我写一篇面向大学新生的低成本自律笔记，偏小红书搜索感。 | goal |
| 2 | 标题不要鸡汤，要像用户会主动搜索的问题。 | confirmed fact |
| 3 | 先给我完整初稿。 | draft create |
| 4 | 这版里“逆袭”这个词去掉，我不想要这种太大的表达。 | rejected decision |
| 5 | 开头也不要说教，换成更生活化的场景。 | accepted decision |
| 6 | 再改一次，重点保留“晚上拖延”这个切口。 | focus |
| 7 | 现在基于你最新那版 draft，把标题改得更像搜索词，再给我一个更短的开头。 | validation |

### 重点判分

- `artifact_alignment`
- `decision_retention`
- `focus_retention`

### 通过关注点

- 最后一次回答必须基于最新 draft，而不是回退到初稿逻辑
- 回答应继续避开“逆袭”这种被否掉的词

## 脚本 5：summary failure / stale fallback

### 场景

- `trend` 或 `content`
- 人为注入 summary 调用失败

### 目标

- 验证 summary 失败时业务输出仍可用，且状态被标记

### 前置条件

- 测试环境允许 mock / 注入 summary 失败

### 固定步骤

| 步骤 | 操作 | 关注点 |
|---|---|---|
| 1 | 构造一个超过 12 条消息的对话 | 触发 summary update 条件 |
| 2 | 人为让 `memory.summarize_conversation` 失败 | 故障注入 |
| 3 | 再发送一条正常业务消息 | 验证业务输出 |
| 4 | 检查 `summaryStatus` 与 `memoryMeta` | 验证 stale |

### 重点判分

- `stale_flag_ok`
- `business_output_survives_summary_failure`

### 通过关注点

- 用户仍拿到业务回复
- summary 状态被明确标记，不是静默吞掉

## 脚本 6：80 条上限保护

### 场景

- `trend`
- 接近 80 条原文上限

### 目标

- 验证旧消息即将被丢弃、但 summary 未覆盖时，系统会阻断不安全继续

### 前置条件

- 可构造接近 80 条 raw message 的 scope
- 可注入 summary 失败或 coverage 不一致

### 固定步骤

| 步骤 | 操作 | 关注点 |
|---|---|---|
| 1 | 构造接近 80 条消息的 scope | 上限前状态 |
| 2 | 保证最老一段消息尚未被 summary 覆盖 | 风险条件 |
| 3 | 触发继续对话 | 观察保护行为 |
| 4 | 检查系统是否阻断并给出后续动作 | safe guard |

### 重点判分

- `unsafe_discard_block_ok`

### 通过关注点

- 不允许静默继续并丢失记忆
- 应给出 save / new conversation 或同等处理路径

## 执行建议

建议执行顺序：

1. 脚本 1
2. 脚本 2
3. 脚本 3
4. 脚本 4
5. 脚本 5
6. 脚本 6

原因：

- 先测正常连续性
- 再测恢复
- 最后测异常与边界

## 推荐记录方式

每跑完一个脚本，至少同步：

- [rolling-memory-evaluation-template.md](./rolling-memory-evaluation-template.md)
- DevTrace `optimization-test`

## 关联文档

- [rolling-memory-evaluation.md](./rolling-memory-evaluation.md)
- [rolling-memory-evaluation-template.md](./rolling-memory-evaluation-template.md)
