# 人设打造、热门追踪与笔记撰写保存按钮规则

本文档用于明确当前前端里，`人设打造`、`热门追踪` 与 `内容撰写` 三个板块的保存按钮什么时候会出现、什么时候不会出现，以及它与 harness 的 `discussionOnly / structuredResult` 规则是什么关系。

## 总原则

按照当前 harness 约定：

- 普通讨论态使用 `discussionOnly = true`
- 结构化结果态使用场景专属字段
- 热门追踪对应 `completeAnalysis`
- 内容撰写对应 `completeDraft`
- 人设打造对应完整 `personaDraft` 或初版 persona 结构
- 保存按钮不应靠前端随意猜测，而应尽量跟结构化结果态同步
- 但热门追踪聊天页允许存在一个只服务该场景的“主动实时总结”例外规则

可参考：

- [harness-overview.md](../../../../docs/harness/01-foundation/harness-overview.md)
- [harness-scenario-response-contract.md](../../../../docs/harness/02-orchestration/contracts/harness-scenario-response-contract.md)

---

## 一、人设打造

人设打造分为两类入口：

- 聊天态里的消息级保存按钮
- 初始态已保存概要图上的 `继续完善` 按钮

两者语义不同，不能混用。

### 1. 消息级保存按钮出现条件

人设聊天态里，只有结构化人设结果允许显示保存按钮。

可保存结构包括：

- `persona.analyze` 首次生成的初版人设
- `persona.follow_up` 后续重新汇总出的完整人设草稿

普通讨论态不显示保存按钮。只解释方向、追问偏好、讨论说法或信息尚不完整时，即使响应里有零散字段，也不应显示保存按钮。

### 2. 保存后实际保存什么

点击消息级保存按钮时，应保存这条结构化人设结果对应的完整数据，而不是保存页面概要图。

保存数据可以包含：

- `persona`
- `niche`
- `audience`
- `contentStyle`
- `referenceCreatorDirections`
- `basicInfo`
- `keywords`
- `personaPosition`
- `contentTone`
- `cardPreview`
- 当前可见会话的必要快照

其中 `cardPreview` 或概要图短字段只服务初始态快速扫读，不代表完整人设正文。

### 3. 初始态概要图与 `继续完善`

人设初始态读取到已保存人设后，可以展示概要图，并在概要图右下角提供 `继续完善` 按钮。

该按钮不是保存按钮，也不是重新生成按钮。
该按钮的类型应明确定义为：`初始态页面级重入按钮`。

语义边界：

- 它属于人设初始态概要图区域的页面动作。
- 它不属于聊天消息下方的 `MessageActions`。
- 它不属于保存链路。
- 它不属于 Agent 运行态动作。
- 它只负责把用户带回“已保存结构化人设草稿”的聊天现场。

点击 `继续完善` 时必须：

1. 读取本地已保存的完整结构化人设。
2. 切换到人设聊天态。
3. 在聊天流中只展示一条 assistant 消息，用于重新渲染上一次保存的人设结构化草稿。
4. 不调用 `persona.analyze`。
5. 不调用 `persona.follow_up`。
6. 不让 Agent 重新总结、补写或新编数据。
7. 不展示历史 `conversation`。
8. 不展示 `nextQuestions`、`followUpQuestions` 或“后续可继续补充问题”。

如果完整保存数据缺少某个结构化字段，前端应直接不展示该字段，不得用概要图或自然语言推断补齐。

### 4. 用户继续输入后的行为

用户从 `继续完善` 进入聊天态后，只有在输入框提交新的修改意见时，才调用 `/api/persona/follow_up`。

这时上下文基于“已保存结构化人设草稿 + 用户新输入”继续，不应在提交前自动触发任何 Agent 请求。

---

## 二、热门追踪

### 1. 保存按钮出现的直接条件

当前规则已经调整为两层：

- 热门追踪 `history` 初始页：没有消息保存按钮
- 热门追踪 `chat` 聊天页：每一条 `assistant` 消息都显示保存按钮
- `user` 消息不显示保存按钮

代码位置：

- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A1146)

只要 `onSave` 不存在，[MessageActions.tsx](../../../../frontend/components/MessageActions.tsx%3A13) 就不会渲染保存按钮。

### 2. 保存按钮点击后实际做什么

热门追踪聊天页里的保存按钮，现在要区分两种消息：

1. 如果当前 assistant 消息本身已经带完整 `analysis`
2. 如果当前 assistant 消息只是普通文本回复，没有 `analysis`

对应规则：

1. 结构化 assistant 消息保存按钮：
   - 直接使用这条消息自带的 `analysis`
   - 直接刷新当前热门追踪概要展示
   - 直接调用 `/api/trends/save` 保存
   - 保存时要一并带上当前整段热门追踪会话的可见 `conversationHistory`
   - 不额外重新总结
2. 普通 assistant 文本消息保存按钮：
   - 读取当前热门追踪会话里的全部聊天记录
   - 通过热门追踪专属 `realtime_progress` 模式调用一次后端
   - 让 Agent 基于整段聊天记录重新总结当前阶段结论
   - 返回新的 `completeAnalysis + cardPreview`
   - 先刷新当前热门追踪概要展示
   - 这份总结结果默认只回传给概要图 / 历史卡片更新，不额外在聊天界面插一条新的总结消息
   - 再调用 `/api/trends/save` 把新的总结结果保存进热门追踪历史
   - 保存时同样要带上总结后的完整 `conversationHistory`

也就是说：

- 保存按钮的显示位置是“每条 assistant 消息”
- 但保存动作要先判断当前消息是不是结构化消息
- 这条规则只对热门追踪成立，不推广到内容撰写或通用聊天

### 3. `analysis` 是什么时候生成的

只有在后端返回可用的 `completeAnalysis` 时，前端才会构造 `analysis`，并把这条消息视为“可保存结构化结果”。

代码位置：

- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A642)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A650)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A678)

如果 `completeAnalysis` 不存在，前端会走普通文本消息分支，不会生成保存按钮。

### 4. `completeAnalysis` 最低有效条件

前端会先调用 `readCompleteAnalysisPayload` 校验结构化结果。当前最低要求是：

- `trackName` 为非空字符串
- `trends` 为非空字符串
- `audience` 为非空字符串
- `topics` 至少包含 1 条非空字符串

代码位置：

- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A263)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A266)
- [frontend/app/trending/page.tsx](../../../../frontend/app/trending/page.tsx%3A269)

也就是说，哪怕用户输入了“像生成报告一样”的关键词，只要后端最终没有返回完整 `completeAnalysis`，保存按钮也不会出现。

### 5. “总结实时进度”按钮和保存按钮的关系

热门追踪聊天页在输入框上方还允许存在一个 `总结实时进度` 按钮。

这个按钮与消息保存按钮的关系是：

- 两者都只存在于热门追踪聊天页
- 两者都会刷新当前热门追踪概要展示
- `总结实时进度` 是热门追踪聊天页的场景专属页面动作按钮
- 它的基础配色、字号、圆角、边框、内边距、阴影应与 `AgentStatusMessage` 状态壳层保持一致
- 但它是新的按钮类型，不应直接复用为状态提示组件
- 区别只在于：
  - 结构化消息保存按钮直接保存当前结构化结果
  - 普通消息保存按钮会先重新总结，再保存
  - `总结实时进度` 会先重新总结，但不强制保存历史
  - 普通消息保存按钮和 `总结实时进度` 的总结结果都默认不回写成聊天流里的新消息

### 6. 用户输入和保存按钮的关系

保存按钮不是由某个关键词直接控制，而是通过下面这条链路间接决定：

1. 用户输入的内容
2. 后端判断这是不是“正式生成热门追踪结果”的请求
3. Agent / service 是否产出完整 `completeAnalysis`
4. 前端把 assistant 消息标记为可触发热门追踪专属总结
5. 保存按钮出现

后端当前更容易触发结构化热门追踪结果的输入，通常包含这些词：

- `开始追踪`
- `完整追踪`
- `完整报告`
- `输出报告`
- `生成报告`
- `给我选题`
- `推荐选题`
- `重新追踪`
- `重新生成`
- `重新来一版`
- `换一批选题`
- `再给我选题`
- `再生成`
- `保存这份`
- `保存结果`
- `定稿`

代码位置：

- [backend/app/services/trend/service.py](../../../../backend/app/services/trend/service.py%3A246)

另外这些分析型词也更容易触发结构化结果：

- `热点`
- `趋势`
- `选题`
- `追踪`
- `赛道`
- `受众需求`
- `内容方向`
- `推荐几个`
- `推荐一些`
- `来一版`
- `出一版`
- `换个方向`
- `继续分析`
- `继续追踪`
- `继续给我`
- `再来几个`
- `再出几个`
- `再推荐`
- `重新给我`

代码位置：

- [backend/app/services/trend/service.py](../../../../backend/app/services/trend/service.py%3A380)

另外如果前端主动以 `summaryMode = "realtime_progress"` 调用热门追踪接口，则不依赖这些关键词，也必须强制返回完整结构化总结。

### 7. 哪些输入通常不会出现保存按钮

以下输入通常不会出现保存按钮：

- 纯敷衍输入：如“嗯”“好”“继续”
- 解释型输入：如“为什么优先这个”“展开讲讲”“什么意思”
- 只聊天、不要求生成赛道热点结果的输入

原因是这类输入通常会让后端返回 `discussionOnly` 风格结果，而不是 `completeAnalysis`。

---

## 三、内容撰写

内容撰写规则不受这次热门追踪特供逻辑影响，仍保持：

- 只在最后一条完整草稿 assistant 消息上显示保存按钮
- 不新增“总结实时进度”按钮
- 不引入 `realtime_progress` 模式

以下内容维持现状。

### 1. 保存按钮出现的直接条件

当前笔记撰写页里，保存按钮只会出现在：

- 当前 assistant 消息带有 `draft`
- 且这条 assistant 消息是当前对话最后一条消息

代码位置：

- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A1550)

实际渲染条件是：

```tsx
onSave={message.draft && index === conversationHistory.length - 1 ? () => void saveContentMessage(message) : undefined}
```

### 2. `draft` 是什么时候生成的

只有在前端成功读到完整草稿结构后，assistant 消息才会带 `draft`，并被视为可保存。

代码位置：

- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A758)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A768)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A821)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A973)

如果当前返回只是讨论态，则 assistant 消息只是一段文本，不会出现保存按钮。

### 3. `completeDraft` 最低有效条件

前端会通过 `readCompleteDraftPayload` 判断草稿是否完整。当前最低要求是：

- 标题存在
- 引入存在
- 正文存在
- 结尾存在
- 标签存在

代码位置：

- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A298)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A306)
- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A308)

即使用户输入了“帮我写一篇”之类的话，只要返回结果缺任何一个关键字段，前端也会把它当成讨论态，而不是完整草稿态。

### 4. 讨论态和保存按钮的关系

内容撰写页有一段专门的讨论态识别逻辑：

- `raw.isReadyToSave === false`
- 且没有可用的 `draft` / `raw.draft`
- 且同时存在普通文本回复

代码位置：

- [frontend/app/content/page.tsx](../../../../frontend/app/content/page.tsx%3A291)

一旦命中讨论态，就不会生成结构化 `draft`，自然也不会出现保存按钮。

### 5. 用户输入和保存按钮的关系

内容撰写同样不是“关键词直接决定保存按钮”，而是下面这条链路：

1. 用户输入主题或修改要求
2. 后端返回 `discussionOnly` 或 `completeDraft`
3. 前端成功解析成完整 `StructuredDraft`
4. 最后一条 assistant 消息挂上 `draft`
5. 保存按钮出现

所以更本质的判断标准不是“有没有某个词”，而是：

- 当前轮是否已经形成完整可保存笔记结构

### 6. 哪些情况通常不会出现保存按钮

这些情况通常不会出现保存按钮：

- 只是讨论内容方向，还没正式起稿
- 只是解释为什么这样写
- 只是问你要不要改某个风格
- 返回结果没有完整标题 / 正文 / 结尾 / 标签
