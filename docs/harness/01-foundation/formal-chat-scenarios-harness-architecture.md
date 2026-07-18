# 正式聊天场景 Harness 架构

## 目标

本文档基于当前仓库代码与现有 `docs/harness/` 体系，重新梳理 KOC 当前正式聊天场景的真实架构。

这里的“正式聊天场景”指：

- 人设打造
- 热门追踪
- 内容撰写
- 灵光一闪 `/?view=dialog`

本文档不重新发明一套新架构，而是沿着当前已经形成的 harness 思路，把现状按：

- 前端
- 后端
- Agent

三层重新收束，并明确：

1. 哪些属于三层共享的正式通用能力
2. 哪些属于场景特例
3. 三层之间这些通用项与特例如何一一对应
4. 哪些现状当前先保留
5. 哪些属于后续继续统一项

当前不纳入本轮正式聊天主线的页面：

- `/data`
- `/operation`

它们继续视为扩展页，不在本文件中作为正式聊天场景展开。

## 与现有文档的关系

本文件回答的是：

```text
当前正式聊天场景在前端 / 后端 / Agent 三层上的真实架构是什么
```

与其他文档的分工如下：

- [harness-overview.md](./harness-overview.md)
  - 定义当前 harness 总纲与统一抽象
- [agent-architecture.md](./agent-architecture.md)
  - 说明 Agent 独立服务的总体架构
- [frontend-backend-agent-handoff.md](../02-orchestration/contracts/frontend-backend-agent-handoff.md)
  - 定义前端、后端、Agent 之间的交接契约
- [persona-workflow.md](../02-orchestration/scenarios/persona-workflow.md)
- [trend-tracking-workflow.md](../02-orchestration/scenarios/trend-tracking-workflow.md)
- [content-writing-workflow.md](../02-orchestration/scenarios/content-writing-workflow.md)
  - 分别定义各场景自身的业务 workflow

因此：

- 本文件负责“正式聊天场景的三层架构梳理”
- 各场景 workflow 文档继续负责“单场景业务细节”

## 固定术语

为避免前端、后端、Agent 三层各自使用不同叫法，本文档固定采用以下术语。

### 页面态术语

- `入口态`
  - 页面尚未进入正式多轮对话时的承载态，例如表单、历史卡片、草稿箱、首页说明
- `聊天态`
  - 页面已进入正式多轮对话后的工作态
- `三段式聊天骨架`
  - 顶部头部区、中部消息滚动区、底部输入区

### 消息流术语

- `消息流`
  - 按时间顺序排列的用户消息、assistant 消息与状态反馈块
- `用户消息卡片`
  - 位于右侧的用户消息气泡
- `assistant 消息卡片`
  - 位于左侧的 assistant 内容卡片

### 结果与渲染术语

- `结构化结果`
  - 可被场景专属逻辑消费的业务结果，例如 `completeAnalysis`、`completeDraft`
- `结构化结果渲染器`
  - 负责渲染结构化结果的场景组件

### 状态与通知术语

- `状态反馈块`
  - 与当前 Agent 请求直接绑定的主状态通道，只承载 `running / stopped / error`
- `顶部轻量通知`
  - 页面级短时提醒，只承载保存成功、删除成功、已更新与轻量错误提示

### 动作术语

- `消息级动作`
  - 挂在 assistant 消息下方的动作，例如重新生成、保存
- `页面级场景动作`
  - 不属于单条消息，而属于当前场景页面的主动动作，例如热门追踪的“总结实时进度”

### 认证术语

- `认证弹窗`
  - 登录 / 注册主弹窗
- `解锁弹窗`
  - 提示用户登录以解锁能力的弹窗
- `注册成功弹窗`
  - 注册完成后的辅助反馈弹窗

### 恢复与隔离术语

- `会话恢复`
  - 页面对 `viewMode`、消息流、局部草稿、滚动位置的 session 级恢复
- `用户隔离`
  - 登录切换后各用户的人设、趋势、草稿、会话现场不相互串用

## 当前正式场景范围

### 人设打造

- 前端页面：`/profile`
- 核心任务：
  - `persona.analyze`
  - `persona.follow_up`

### 热门追踪

- 前端页面：`/trending`
- 核心任务：
  - `trend.track`

### 内容撰写

- 前端页面：`/content`
- 核心任务：
  - `content.draft`
  - `content.revise`

### 灵光一闪

- 前端页面：`/?view=dialog`
- 当前仍走：
  - `general.chat`

说明：

- 灵光一闪当前没有保存链路，也没有结构化业务结果
- 但在前端页面体系里，它已经是一个正式页面入口，不再只是“仓库之外的临时想法”
- 本文件把它纳入正式聊天场景范围，但只要求它先接入最小通用能力

### 扩展页排除说明

以下页面当前不纳入正式聊天场景主线：

- `/data`
- `/operation`

原因：

- 它们当前没有对应后端业务主链路
- 没有独立 Agent 正式任务入口
- 也没有进入三段式聊天骨架主路径

## 前端架构

### 前端职责边界

当前前端负责：

- 页面与交互
- 用户输入收集
- 消息流展示
- 普通文本渲染
- 结构化结果渲染
- 状态反馈块展示
- 顶部轻量通知
- 保存动作触发
- 本地 session 级会话恢复
- 登录与解锁交互入口

当前前端不负责：

- 业务结果完整性判定
- 业务结果最终结构化归一化
- 真实业务数据权限控制
- 直接调用 Agent 独立服务

### 页面态结构

当前正式页面在前端层的入口态 / 聊天态对应关系如下：

| 场景 | 入口态 | 聊天态 |
| --- | --- | --- |
| 人设打造 | `form` | `chat` |
| 热门追踪 | `history` | `chat` |
| 内容撰写 | `drafts` | `chat` |
| 灵光一闪 | 首页说明 / 对话入口 | `view=dialog` 对话态 |

结论：

- 四个正式页面都可以被描述为“入口态 + 聊天态”
- 灵光一闪当前虽然没有显式 `viewMode` 字段，但在架构上仍应按同类页面理解

### 三段式聊天骨架

当前 `profile / trending / content / ?view=dialog` 的聊天区都已基本形成同一套三段式骨架：

1. 顶部头部区
2. 中部消息滚动区
3. 底部输入区

前端后续新增正式聊天页时，默认应先继承这套骨架，而不是重写一套独立页面协议。

### 消息流协议

当前正式聊天态中的主内容统一归入消息流。

消息流中允许出现三类正式内容：

- 用户消息卡片
- assistant 消息卡片
- 状态反馈块

规则：

- 用户消息固定在右侧
- assistant 消息固定在左侧
- 状态反馈块不应伪装成普通 assistant 正文
- 结构化结果必须挂在 assistant 消息卡片内消费

### 前端通用能力

当前已经形成、或已明显收敛为前端通用能力的部分包括：

- `ScenarioHeader`
- `MarkdownText`
- `normalizeAiMarkdown`
- `AgentStatusMessage`
- `TopToast`
- `MessageActions`
- `conversation-memory`
- `AuthContext`
- `AppStateContext`
- `AuthStateBridge`
- `RequirePersona`

这些能力不必全部在所有页面同时启用，但都属于正式前端通用基础设施。

### 前端认证与门禁基础设施

当前前端认证链路由以下部分组成：

- [AuthContext.tsx](../../../frontend/context/AuthContext.tsx)
- [AuthDialog.tsx](../../../frontend/components/AuthDialog.tsx)
- [UnlockDialog.tsx](../../../frontend/components/UnlockDialog.tsx)
- [RegisterSuccessDialog.tsx](../../../frontend/components/RegisterSuccessDialog.tsx)
- [LoginButton.tsx](../../../frontend/components/LoginButton.tsx)
- [login/page.tsx](../../../frontend/app/login/page.tsx)

结论：

- 登录 / 注册 / 解锁不属于单个业务页私有逻辑
- 它们属于正式前端架构的一部分
- 架构文档中必须单独说明其位置，而不是只在页面里零散提到

### 前端场景特例

#### 人设打造特例

- 入口态是信息表单
- 游客允许首轮体验
- 当前结果展示仍主要是 Markdown 文本化人设草稿
- 手动保存与自动落库并存

#### 热门追踪特例

- 入口态是历史追踪记录
- 存在 `completeAnalysis`
- 存在 `cardPreview`
- 存在页面级场景动作“总结实时进度”
- 存在 `summaryMode = realtime_progress`

#### 内容撰写特例

- 入口态是草稿箱
- 存在 `completeDraft`
- 存在 `DraftRenderer`
- 存在 suggestions chips
- 存在 `writingEntrySource -> draftSource`

#### 灵光一闪特例

- 当前为轻量正式聊天页
- 不保存到后端业务库
- 仅保留浏览器本地单条会话现场
- 不结构化
- 不做人设前置门禁
- 初始页当前先保留
- 聊天态头部允许存在“新建”动作，用于清空本地会话并回到 `/?view=dialog` 初始页

## 后端架构

### 后端职责边界

当前后端负责：

- 对前端暴露业务接口
- 做登录与用户隔离
- 装配 `input / context / options`
- 调用 Agent 独立服务
- 对 Agent 返回进行业务归一化
- 决定是否落库

当前后端不负责：

- 页面展示
- 页面内的状态反馈块 UI
- 页面级轻量通知 UI

### 后端业务接口层

当前正式业务接口主要包括：

- `/api/chat`
- `/api/persona/analyze`
- `/api/persona/follow_up`
- `/api/persona/save`
- `/api/persona/me`
- `/api/trends/track`
- `/api/trends/save`
- `/api/trends/history`
- `/api/trends/latest`
- `/api/content/draft`
- `/api/content/save`
- `/api/content/history`
- `/api/auth/*`

### 后端通用能力

当前后端通用能力主要包括：

- 鉴权与用户识别
- `ContextBuilder`
- `build_agent_options`
- `agent_debug`
- 结果态归一化
- CRUD 落库

#### `ContextBuilder`

当前统一由：

- [builder.py](../../../backend/app/adapters/agent/builder.py)

负责将前端页面输入转成 Agent 可消费的 `context`。

#### `build_agent_options`

当前统一由：

- [options.py](../../../backend/app/adapters/agent/options.py)

负责注入：

- `runtimeProvider`
- `enableTools`
- 调试覆盖项

#### 结果态归一化

当前后端已较完整落实的正式结果壳是：

- 热门：`discussionOnly + completeAnalysis + text + raw`
- 内容：`discussionOnly + completeDraft + draft + suggestions + text + raw`

人设当前仍主要是：

- 原始 `data` 回前端

因此：

- 人设结果壳尚未完全收口
- 热门与内容的结果壳已明显进入正式 harness 口径

### 后端场景特例

#### 人设打造

- `persona.analyze` 会自动消费 `savePayload`
- 手动保存仍通过 `/api/persona/save`

#### 热门追踪

- 存在 `summaryMode = realtime_progress`
- 保存仍主要依赖前端显式调用 `/api/trends/save`

#### 内容撰写

- `writingEntrySource` 进入后端
- 保存时转成 `draftSource`
- `content.revise` 仍复用 `/api/content/draft`

## Agent 架构

### Agent 职责边界

当前 Agent 独立服务负责：

- 接收统一 `/agent/run`
- 根据 `taskType` 分发 workflow
- 加载 prompt
- 运行模型或 mock runtime
- 在允许时执行检索工具
- 返回统一 `AgentRunResponse`

当前 Agent 不负责：

- 前端业务路由
- 登录
- Mongo 落库
- 页面 UI 状态块

### Agent 通用基础设施

当前 Agent 的通用基础设施包括：

- `TaskRouter`
- `PromptLoader`
- `BaseWorkflow`
- runtime
- retrieval/tool registry
- `web_search`
- `mock_retrieval`

### Agent 任务分层

当前正式主线相关任务包括：

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `content.draft`
- `content.revise`

### Agent 工具与联网搜索

当前联网搜索能力位于 Agent 工具层，而不是位于前端或后端业务层。

核心链路为：

```text
workflow
→ ToolRegistry
→ web_search / mock_retrieval
→ RetrievalToolResult
→ workflow 最终生成
```

当前与工具相关的正式口径：

- `enableTools` 控制当前请求是否允许实际调用工具
- `web_search` 是统一检索入口
- `tavily` 只是 `web_search` 的 provider 之一
- 当前热门、内容、部分人设流程在代码上保留了检索能力
- 但是否实际执行检索仍以后端请求级开关为准

### Agent 场景特例

#### 人设打造

- `persona.analyze` 代码上可走检索链路
- `persona.follow_up` 当前仍以已有上下文为主

#### 热门追踪

- `trend.track` 是当前最完整的结构化主线之一

#### 内容撰写

- `content.draft` 支持完整起稿链路
- `content.revise` 当前与起稿分支不完全对称

#### 灵光一闪

- 当前仍走 `general.chat`
- 不承载保存与结构化业务结果

## 三层一一对应关系

当前正式 harness 架构要求：前端、后端、Agent 的通用项与场景特例必须一一对应。

### 通用项对应

| 能力项 | 前端 | 后端 | Agent |
| --- | --- | --- | --- |
| 普通文本对话 | `MarkdownText` 展示 | 返回 `text` / `reply` | 生成普通文本结果 |
| 状态反馈块 | UI 状态块展示 | 不把状态混入正文 | 返回成功/失败执行结果 |
| 顶部轻量通知 | 页面级短时提示 | 返回轻量成功/失败接口结果 | 不负责通知 UI |
| 结构化结果 | 结构化 renderer 消费 | 归一化结果壳 | 生成结构化业务数据 |
| 保存动作 | 触发保存接口 | 负责真实落库 | 可返回 `savePayload` 建议 |
| 会话恢复 | session 级恢复 | 提供历史/当前用户数据 | 不直接负责前端恢复 |
| 登录门禁 | 弹窗、页面门禁 | session 与用户校验 | 不做登录权限控制 |

说明：

- 表中的“会话恢复”默认指页面现场恢复。
- 人设、热门、内容当前以 session 级现场恢复为主。
- 灵光一闪当前使用浏览器 `localStorage` 保留单条轻量聊天现场，作用范围仍限于前端本机，不等同于后端业务保存。

### 场景特例对应

| 场景 | 前端特例 | 后端特例 | Agent 特例 |
| --- | --- | --- | --- |
| 人设打造 | 表单入口、游客提示、Markdown 人设草稿 | 自动消费 `savePayload` | `persona.analyze / follow_up` |
| 热门追踪 | 历史卡片、总结实时进度 | `summaryMode = realtime_progress` | `trend.track` |
| 内容撰写 | 草稿箱、suggestions、`DraftRenderer` | `writingEntrySource -> draftSource` | `content.draft / revise` |
| 灵光一闪 | 轻量对话页、本地单会话恢复、新建重置 | `/api/chat` | `general.chat` |

## 灵光一闪作为正式页面的最低接入要求

当前把灵光一闪纳入正式页面体系时，只要求它先接入最小通用能力。

### 必须接入

- 正式页面身份
- 消息流
- 用户消息卡片
- assistant 消息卡片
- 底部输入区
- 发送 / 停止语义
- 状态反馈块
- Markdown 文本链路
- 会话滚动能力
- 浏览器本地单会话恢复
- 新建重置动作
- 认证弹窗体系兼容

### 当前明确不要求

- 后端保存
- 结构化结果 renderer
- 人设前置门禁
- 历史卡片
- 草稿箱

### 当前本地会话策略

- 灵光一闪只保留当前浏览器里的单条会话现场，不提供多会话列表。
- 当前实现使用 `localStorage` 保存消息流、状态反馈和滚动位置，使切换页面、刷新页面、重开浏览器后仍能回到上一条轻量聊天。
- 同一前端运行期间，灵光一闪在 Agent 输出中切换到其他页面后，请求应继续运行；完成后应把最新 assistant 回复写回本地会话现场，回到 `/?view=dialog` 时直接恢复最新结果。
- 点击“新建”必须清空该本地会话现场，并回到 `/?view=dialog` 的灵光一闪初始页。
- 只有刷新页面、重开浏览器或运行时上下文丢失导致原请求无法继续时，才允许把旧 loading 状态降级为可见的中断状态反馈。

### 当前初始页策略

- 初始页先保留
- 不要求本轮改成与三大业务页同复杂度的入口态

## 当前现状保留项

以下内容当前先保留，不在本轮架构梳理中强制改变：

- 人设页当前 Markdown 文本化结果展示
- 人设保存双路径现状
- 热门追踪普通生成态与总结实时进度双运行态
- 内容修改继续复用 `/api/content/draft`
- 灵光一闪当前轻量正式页定位
- 登录 / 注册 / 解锁弹窗当前体系

## 后续统一项

以下内容记为后续继续统一项：

- 滚到底部能力补齐到全部正式聊天页
- 状态反馈块插入位置进一步严格统一
- 消息区、assistant 卡片、输入区宽度约束进一步严格统一
- 生成中输入框行为统一
- 文档路径由绝对地址迁移为相对地址
- 用户隔离进一步收口
- 共享壳层进一步组件化

## 参考证据索引

### 核心文档

- [harness-overview.md](./harness-overview.md)
- [agent-architecture.md](./agent-architecture.md)
- [frontend-backend-agent-handoff.md](../02-orchestration/contracts/frontend-backend-agent-handoff.md)
- [harness-scenario-response-contract.md](../02-orchestration/contracts/harness-scenario-response-contract.md)

### 场景文档

- [persona-workflow.md](../02-orchestration/scenarios/persona-workflow.md)
- [trend-tracking-workflow.md](../02-orchestration/scenarios/trend-tracking-workflow.md)
- [content-writing-workflow.md](../02-orchestration/scenarios/content-writing-workflow.md)

### 前端代码

- [profile/page.tsx](../../../frontend/app/profile/page.tsx)
- [trending/page.tsx](../../../frontend/app/trending/page.tsx)
- [content/page.tsx](../../../frontend/app/content/page.tsx)
- [page.tsx](../../../frontend/app/page.tsx)
- [AuthContext.tsx](../../../frontend/context/AuthContext.tsx)
- [AppStateContext.tsx](../../../frontend/context/AppStateContext.tsx)

### 后端代码

- [persona.py](../../../backend/app/endpoints/web/persona.py)
- [trends.py](../../../backend/app/endpoints/web/trends.py)
- [content.py](../../../backend/app/endpoints/web/content.py)
- [chat.py](../../../backend/app/endpoints/web/chat.py)
- [builder.py](../../../backend/app/adapters/agent/builder.py)

### Agent 代码

- [task_router.py](../../../agent/app/router/task_router.py)
- [persona.py](../../../agent/app/workflows/persona.py)
- [trend_tracking.py](../../../agent/app/workflows/trend_tracking.py)
- [content_writing.py](../../../agent/app/workflows/content_writing.py)
- [loader.py](../../../agent/app/prompts/loader.py)
