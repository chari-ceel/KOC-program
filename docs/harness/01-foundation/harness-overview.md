# Harness 总纲：对话场景统一抽象

## 目标

本文档是当前 `docs/` 体系中的 harness 总纲文档之一。

当前仓库一期里的人设打造、热门追踪、内容撰写，统一视为同一种正式业务对话能力：

- 本质上都是 AI 多轮对话场景
- 共享同一套前后端主链路
- 共享同一套结果态模型
- 只在场景配置、prompt、context 与结构化结果 schema 上允许分化

此外，当前正式聊天页面体系里还包括：

- 灵光一闪 `/?view=dialog`

说明：

- 灵光一闪当前仍走 `general.chat`
- 它已经纳入正式聊天页面体系
- 但当前不承载保存链路，也不承载结构化业务结果
- 因此本文档仍以“人设 / 热门 / 内容”三条正式业务主线作为统一抽象主体；灵光一闪的页面级通用能力与场景边界，以下钻文档 `formal-chat-scenarios-harness-architecture.md` 为准

本文档主要回答两个问题：

1. 这三条正式业务主线在架构上应该如何统一
2. 当前代码有哪些地方偏离了这套统一模型

## 统一抽象

`persona`、`trend`、`content` 三条正式业务主线统一抽象为：

```text
Agent Conversation Scenario
```

每个场景由同一套骨架驱动：

- `scenarioType`
- `taskType`
- `prompt`
- `contextBuilder`
- `resultStateResolver`
- `structuredResultSchema`
- `renderer`
- `saveAction`

对应到当前一期正式业务主线：

| 场景 | `scenarioType` | 当前主任务 |
| --- | --- | --- |
| 人设打造 | `persona` | `persona.analyze` / `persona.follow_up` |
| 热门追踪 | `trend` | `trend.track` |
| 内容撰写 | `content` | `content.draft` / `content.revise` |

结论：

- 这三个页面不应再被视为三套独立页面逻辑
- 而应被定义为同一种对话引擎下的三种场景配置

## 统一主链路

三条正式业务主线遵循同一条业务主链路：

```text
用户输入
→ 前端发送标准业务请求
→ 后端装配 input / context / options
→ 后端调用 Agent
→ 后端判定结果态
→ 后端归一化 structuredResult
→ 前端按结果态消费
→ 如有 structuredResult 则渲染、可保存、可继续追问
```

其中职责边界固定如下：

### 前端负责

- 用户输入
- 会话展示
- 结果态消费
- 结构化结果渲染
- 保存动作触发
- 本地 session 级页面状态恢复

### 后端负责

- 业务路由
- `input` / `context` 装配
- Agent 调用
- 结果态判定
- 结构化结果归一化
- 是否允许进入保存链路

### Agent 负责

- 根据 `taskType` 执行对应 workflow
- 生成对话回复
- 生成结构化业务结果
- 在需要时给出下一步建议项

统一原则：

- 前端不负责猜测业务结果是否完整
- 前端不负责发明一套场景专属解析器去推断状态
- “当前是讨论态还是成品态”应以后端判定为准

## 默认运行环境

harness 文档体系默认假设当前项目通过 Docker Compose 运行，而不是通过本地 dev server 散跑。

标准启动方式：

```bash
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d
```

标准访问入口：

- 前端直连：`http://127.0.0.1:5000`
- Nginx 聚合入口：`http://127.0.0.1:8928`

说明：

- `frontend` 容器内部仍监听 `3000`，但这不是 harness 默认入口。
- 多会话 / 多 Agent 场景下，禁止直接执行裸 `docker` 或 `docker compose`；必须统一通过 `tools/docker_queue.py` 进入队列。
- 后续文档中的联调、测评、错误复现，除非明确标注“单独本地调试”，否则默认都基于 Docker Compose 环境。

## 统一结果态模型

三条正式业务主线先统一结果态，再允许结构体内容不同。

统一抽象：

- `discussionOnly`
- `structuredResult`

说明：

- `discussionOnly = true` 表示当前只是讨论、解释、澄清、追问，不形成可保存业务结果
- `structuredResult` 表示当前已经形成结构完整、前端可渲染、可继续加工、可保存的业务结果
- “追问”并不必然等于讨论态；如果同一轮已经形成完整结构化结果，追问问题可作为后续继续完善项随结果返回，不阻断保存
- 热门追踪初始页与内容撰写初始页的首条业务输入，必须直接进入 `structuredResult` 主路径，不允许先返回 `discussionOnly = true`

前端消费规则统一为：

- 如果只有 `discussionOnly`，按普通 assistant 对话渲染
- 如果存在 `structuredResult`，按场景专属结构化块渲染
- 是否允许保存，不再单独靠前端猜测，默认与 `structuredResult` 同步

### 场景映射

统一结果态在不同场景里的业务名字可以不同：

| 场景 | 讨论态 | 结构化结果 |
| --- | --- | --- |
| 人设打造 | `discussionOnly` | `personaDraft` |
| 热门追踪 | `discussionOnly` | `completeAnalysis` |
| 内容撰写 | `discussionOnly` | `completeDraft` |

即：

- 壳统一
- 结果体名字可以按场景表达

## 场景最小结构化结果

### 人设打造

人设场景当前保存逻辑保持不变；结构化结果统一命名为 `personaDraft`，至少覆盖：

- `persona`
- `niche`
- `audience`
- `contentStyle`
- `followUpQuestions`

用于显示保存按钮的完整 `personaDraft` 至少应覆盖：

- `persona.name` 或 `persona.description`
- `niche.primary` 或 `niche.secondary`
- `audience`
- `contentStyle`

如果本轮完整 `personaDraft` 已形成，`nextQuestions` / `followUpQuestions` 只表示可继续优化的问题，不应把该轮降级为讨论态；如果只有零散字段或空草稿，则仍按讨论态处理。

### 热门追踪

热门页采用：

- `discussionOnly`
- `completeAnalysis`

不再单独设计 `canSave`。

只要存在 `completeAnalysis`，前端即可保存。

`completeAnalysis` 的最低完整标准为：

- `trackName`
- `trends`
- `audience`
- `topics` 至少 1 条

这四项齐备，才视为完整分析结果。

此外，完整热门追踪结果应包含：

- `cardPreview.discoveryKeywords`
- `cardPreview.shortTopics`

`cardPreview` 用于热门追踪初始页历史卡片，由 Agent 在生成完整分析时同步输出。前端不应把 `trends`、`audience` 或长摘要截断后当作卡片摘要。
- 热门追踪初始页首条业务输入必须直接返回完整 `completeAnalysis`。

### 内容撰写

内容页采用：

- `discussionOnly`
- `completeDraft`

`completeDraft` 最低应覆盖：

- `title`
- `intro`
- `body`
- `ending`
- `tags`

其中：

- 正式字段统一使用 `intro`
- `hook` 仅作为历史兼容字段保留

此外，完整内容草稿应包含：

- `cardPreview.keywords`

`cardPreview` 用于内容撰写初始页草稿卡片，由 Agent 在生成完整草稿时同步输出。前端不应把 `intro`、`hook` 或 `body` 截断后当作卡片摘要。
- 内容撰写初始页首条业务输入必须直接返回完整 `completeDraft`。

## 建议项模型

内容页的改写建议 chips 不由前端写死规则生成，而定义为 Agent 输出的一种正式结构。

定位：

```text
系统推测用户可能提出的修改建议
```

建议模型：

```json
{
  "label": "把标题改得更像搜索词",
  "instruction": "请把标题改得更像小红书搜索词，保留大学生和低成本自律两个关键词。",
  "intent": "title_optimize"
}
```

字段职责：

- `label`：按钮展示文案
- `instruction`：点击后直接送入 revise 的真实修改指令
- `intent`：建议类型，供系统识别和后续统计使用

规则：

- 仅在内容场景返回完整 `completeDraft` 时生成
- 与 draft 同一次 Agent 返回一起给出
- 讨论态不返回 suggestions

如果热门、人设也扩展“下一步建议”，同样遵循这套建议项 schema，而不是再发明新格式。

## 可变点与不可变点

这是 harness engineer 最需要明确的一层。

### 允许场景差异的部分

- `taskType`
- prompt 内容
- context 装配细节
- 结构化结果 schema
- 页面专属结构化渲染块
- 场景专属保存目标

### 必须统一的部分

- 场景本质是 AI 对话
- 前端到后端的主链路
- 后端到 Agent 的调用入口
- 结果态模型
- 状态判定责任在后端
- 前端只消费结果态与结构化结果
- 建议项输出为正式结构，不由前端随意拼装

如果这一层不写清，很容易重新长回三套实现。

## 当前代码与统一模型的主要偏差

### 1. 人设统一结果壳尚未正式落地

当前 [frontend/app/profile/page.tsx](../../../frontend/app/profile/page.tsx) 首轮已经改为调用后端 `persona.analyze`，不再本地伪造首条 assistant 内容。

但人设场景目前仍然更接近“后端返回 Agent `data`，前端再做展示格式化”，还没有像热门、内容那样正式落成统一结果态壳。

当前现状：

- 人设：首轮与追问都已进入后端链路，但当前仍以文本化结果为主，尚未正式落成统一 `personaDraft` renderer
- 热门：已包装为 `discussionOnly + completeAnalysis + text + raw`
- 内容：已包装为 `discussionOnly + completeDraft + suggestions + text + raw`

统一要求：

- 三者统一为“统一结果态壳 + 场景结构体”
- 人设返回壳本轮仍先不改，只保留接口方向

### 2. 内容页仍存在较多历史兼容分支

当前内容页兼容：

- `intro` / `hook`
- `draft` / `revisedDraft`
- `raw.draft` / `raw.revisedDraft`

这说明当前返回结构尚未完全稳定。

统一要求：

- 正式 schema 收敛到 `intro`
- 结构化结果入口逐步收敛
- 历史兼容逻辑保留为过渡层，而不是长期主实现

### 3. 人设 / 热门 / 内容 的统一程度仍不完全一致

热门与内容主链路已经进入 harness 口径：

- 热门由后端判定 `discussionOnly` 与 `completeAnalysis`
- 内容由后端判定 `discussionOnly` 与 `completeDraft`
- 内容 suggestions 已由 Agent / 后端返回，前端只展示与回填 `instruction`

但人设还处于“先接入统一后端链路，再逐步补统一结果壳”的阶段，所以三者当前还不是完全等形。

## 对 Harness Engineer 的直接约束

`harness engineer` 默认遵守以下规则：

1. 新场景默认继承统一对话骨架，不允许重新发明一套页面协议。
2. 新场景必须先定义结果态，再定义结构化结果 schema。
3. 状态判定优先放在后端，不放在前端页面组件里。
4. suggestions、next actions、follow-up proposals 等，都应视为 Agent 返回结构，而不是前端临时规则。
5. 页面差异只能体现在场景配置和渲染层，不能体现在主链路和状态语义上。

补充：

6. 如果讨论的是正式聊天页面体系，而不是仅讨论三条业务主线，必须同时检查灵光一闪 `/?view=dialog` 是否已接入对应的通用页面能力。
7. 如果讨论的是正式业务结果、保存链路或结构化结果 schema，当前仍以人设 / 热门 / 内容三条业务主线为主，不应误把灵光一闪写成同等业务结果场景。

## 一期当前已确认边界

为了避免文档和当前推进方向冲突，这里记录已确认边界：

- 人设页首轮已改成走后端
- 人设页保存按钮应与后端判定出的结构化人设态同步；完整 `personaDraft + nextQuestions` 仍属于可保存结构化态
- 人设服务统一壳子仍保留逐步收敛方向，但 follow-up 的结构化态判定应先与完整 `personaDraft` 标准对齐
- 热门页已采用 `discussionOnly + completeAnalysis`
- 热门页完整分析最低标准为 `trackName + trends + audience + topics>=1`
- 内容页 suggestions 已改为 AI 返回
- 内容页 suggestions 当前定位为“系统推测用户可能提出的修改建议”
- 三页加载文案统一，这轮不做
- 人设页状态判定以“后端判定 + 完整 personaDraft 标准”为准，不由前端仅凭零散字段猜测
- 灵光一闪已纳入正式聊天页面体系，但当前仍保持轻量对话页定位
- `/data` 与 `/operation` 当前仍不纳入正式聊天场景主线

## 配套更新位置

本文档继续落实到其他文档时，优先更新：

- [agent-api-contract.md](../02-orchestration/contracts/agent-api-contract.md)
- [frontend-backend-agent-handoff.md](../02-orchestration/contracts/frontend-backend-agent-handoff.md)
- [agent-architecture.md](./agent-architecture.md)
- [formal-chat-scenarios-harness-architecture.md](./formal-chat-scenarios-harness-architecture.md)

顺序：

1. 先以本文档作为 harness 总纲
2. 再把正式请求/返回字段写进 API contract
3. 最后把当前实现与目标差异同步进 handoff / architecture 文档
