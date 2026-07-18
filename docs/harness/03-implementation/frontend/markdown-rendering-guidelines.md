# 前端 Markdown 渲染规范

## 目标

本文档定义 KOC 前端如何承接 Agent 返回的 Markdown 文本，并把它稳定渲染到 Web 聊天界面中。

当前阶段只解决 Markdown 渲染问题，不引入历史消息压缩、不改消息存储模型、不要求立即改造为 `parts` 消息结构。

## 背景判断

KOC 当前前端已经具备基础 Markdown 渲染能力：

- 普通文本统一通过 [MarkdownText.tsx](../../../../frontend/components/MarkdownText.tsx) 渲染
- 组件内部使用 `react-markdown`
- 已接入 `remark-gfm`
- 已有 [markdown-normalize.ts](../../../../frontend/lib/markdown-normalize.ts) 对 AI 输出做轻量归一化

因此当前问题不是“是否需要引入 Markdown 渲染器”，而是：

1. Agent 输出经常不是严格标准 Markdown
2. 前端需要清楚哪些内容应作为 Markdown 渲染，哪些内容应走结构化 renderer
3. GFM 表格、任务列表、代码块、链接等内容需要有稳定展示规则
4. 不应为了单页场景临时手写第二套文本解析器

## 参考项目取舍

### 主参考：LibreChat

LibreChat 的核心参考价值不是某个 Markdown 样式，而是它把消息内容按类型拆开处理：

- 普通文本交给 Markdown renderer
- 工具调用、状态、引用、结构化内容由独立组件渲染

这个思路适合 KOC 后续演进，但当前阶段不要求立即改造消息模型。

### 渲染参考：Vercel Streamdown

Streamdown 的参考价值在于处理流式、不完整 Markdown。

当前 KOC 的主链路仍以完整响应为主，因此本阶段不强依赖 Streamdown。后续如果正式引入 SSE / streaming，再评估是否替换或补充 `ReactMarkdown`。

### 扩展参考：Open WebUI

Open WebUI 的 Markdown 渲染能力更复杂，适合未来参考：

- token 级渲染
- HTML sanitize
- iframe / embed
- KaTeX
- 复杂代码块

当前 KOC 不应直接照搬这一级复杂度。

## 当前阶段原则

### 1. Markdown 承载可展示正文文本

Markdown 适用于：

- assistant 讨论态回复
- 用户输入展示
- 人设页当前过渡期的文本化结果
- 简短说明、追问、解释、建议
- 内容草稿等结构化结果里的正文文本字段，例如 `hook`、`body`、`ending`
- 热门追踪、人设等结构化结果中需要作为正文展示的说明性文本

Markdown 不适用于：

- 热门追踪完整结构化结果的整体壳层
- 内容草稿完整结构化结果的整体壳层
- `cardPreview` / 概要图短字段
- 保存状态
- Agent 运行状态
- 错误 / 停止提示
- 后续工具调用详情

如果后端已经返回结构化字段，前端应优先使用结构化 renderer 承载字段分区、标题、标签、动作区等壳层；其中需要展示为正文的字符串字段仍可继续交给 `MarkdownText`。不应把结构化对象重新拼成一大段 Markdown，也不应把 `cardPreview` 当成正文 Markdown 渲染。

### 2. 统一入口是 `MarkdownText`

三类页面中的可展示正文文本必须统一走：

- [MarkdownText.tsx](../../../../frontend/components/MarkdownText.tsx)

不允许：

- 在某个页面手写临时 Markdown 解析
- 在某个页面直接 `dangerouslySetInnerHTML`
- 在业务页面内复制一份 Markdown 样式
- 让不同页面分别决定同一种 Markdown 语法怎么展示

### 3. 归一化和渲染分层

Markdown 处理分两层：

1. `markdown-normalize.ts`
   - 修正 AI 常见非标准输出
   - 不负责视觉样式
   - 不应过度猜测业务含义

2. `MarkdownText.tsx`
   - 调用 Markdown 解析器
   - 注册渲染组件
   - 负责视觉样式和安全展示边界

禁止把这两层混在页面业务逻辑里。

## 推荐渲染能力

`MarkdownText` 应稳定支持以下语法：

- 段落
- 1 到 6 级标题
- 无序列表
- 有序列表
- 加粗
- 斜体
- 删除线
- 行内代码
- fenced code block
- 引用块
- 分割线
- 链接
- GFM 表格
- GFM task list

当前实现已经支持其中一部分。后续增强应优先补齐上述列表，而不是按页面零散补样式。

## AI 输出归一化范围

`normalizeAiMarkdown()` 允许处理以下问题：

- Windows 换行归一为 `\n`
- tab 转空格
- 常见坏代码围栏修正
- 列表符号和加粗之间缺少空格
- 标题黏在正文里
- 常见中文小节标题缺少换行
- 悬空星号、半截强调符号
- 模型把章节标签压缩到一行

可考虑补充但必须谨慎的规则：

- `• xxx` 转为 `- xxx`
- `1、xxx` 转为 `1. xxx`
- `（1）xxx` 转为 `1. xxx`

这些规则只应作用于行首，避免破坏正文里的正常中文标点。

不允许在归一化层做的事情：

- 根据内容猜测它是不是热门结果或草稿结果
- 从长文本中抽取 `cardPreview`
- 生成业务字段
- 把错误提示改写成 assistant 正文
- 把状态消息混入 Markdown 内容

## 安全边界

当前阶段默认不支持用户或 Agent 返回的原始 HTML 渲染。

规则：

- 不使用 `dangerouslySetInnerHTML`
- 不开启未经审计的 HTML rehype 插件
- 链接打开外部地址时必须带 `target="_blank"` 和 `rel="noreferrer"`
- 图片渲染如需开放，必须限制尺寸并处理失败状态
- 如果未来要支持 HTML，必须先引入 sanitize 策略，并在本文档更新白名单

## 与 Agent 状态的边界

以下内容不是 Markdown 正文：

- `Agent 正在结合上下文生成...`
- `本次输出已停止`
- 网络错误
- 接口错误
- 工具调用中
- 工具调用失败

这些内容应走 `AgentStatusMessage` 或后续统一状态 part。

原因：

- 状态消息不应进入可保存正文
- 状态消息不应参与 Markdown 归一化
- 状态消息不应被当作 assistant 正常回复参与后续上下文

## 与结构化结果的边界

热门追踪：

- 有 `analysis` 时，优先渲染热门追踪结构化块
- `message.content` 只作为解释、导语或兜底文本
- `analysis` 内需要作为正文阅读的说明性字段可以由结构化 renderer 再交给 `MarkdownText`

内容撰写：

- 有 `draft` 时，优先渲染 `DraftRenderer`
- `message.content` 不应替代草稿结构化字段
- `DraftRenderer` 负责草稿壳层和字段分区，`draft.hook`、`draft.body`、`draft.ending` 这类正文文本继续走 `MarkdownText`
- `draft.cardPreview` 只服务初始页草稿卡片，不按正文 Markdown 渲染

人设打造：

- 当前仍处于文本承载结构信息的过渡期
- 允许继续用 Markdown 展示
- 后续如果引入 `personaDraft`，应按结构化 renderer 处理
- `personaDraft.cardPreview` 仍是概要短字段，不应混入 Markdown 正文

## 实施建议

### 第一阶段：只增强渲染层

目标：

- 不改消息模型
- 不改后端 contract
- 不动历史消息压缩
- 只增强 `MarkdownText` 和必要的归一化规则

建议改动：

1. 在 `MarkdownText` 里补齐 GFM 表格、task list、删除线、4-6 级标题的组件渲染。
2. 在 `markdown-normalize.ts` 中谨慎补充行首中文编号和圆点列表归一化。
3. 保持 `ReactMarkdown + remark-gfm` 作为当前默认方案。
4. 不引入 Streamdown，除非当前迭代同时引入 streaming。

### 第二阶段：补测试用例

建议增加一组 Markdown fixture，覆盖：

- 标准标题和段落
- 中文编号列表
- 圆点列表
- 表格
- 任务列表
- fenced code block
- 链接
- 半截坏星号
- 中文章节标题黏连正文

测试重点不是截图，而是保证归一化输出不会破坏合法 Markdown。

### 第三阶段：再评估流式渲染

只有在正式引入流式输出时，再考虑：

- Streamdown
- 自己维护 streaming buffer
- 按段落提交 Markdown
- 后端 SSE event type 设计

这个阶段不和当前 Markdown 完整响应渲染混在一起做。

## 验收标准

完成第一阶段后，应满足：

1. 三个正式聊天页普通文本仍统一走 `MarkdownText`。
2. 标准 Markdown 标题、列表、代码块、引用、链接正常显示。
3. GFM 表格不会退化成纯文本挤在一行。
4. task list 不会显示成混乱的原始符号。
5. AI 常见行首 `•`、`1、`、`（1）` 输出可以稳定转成列表。
6. 结构化结果仍由原有结构化 renderer 渲染。
7. Agent 状态不混入 Markdown 正文。
8. `npm run lint` 和 `npx tsc --noEmit` 通过。

## 明确不做

当前阶段不做：

- 历史消息压缩
- 消息 `parts` 模型改造
- 后端响应 contract 改造
- streaming/SSE
- HTML 白名单渲染
- KaTeX / Mermaid
- 代码高亮库接入

这些能力可以后续独立设计，不应塞进当前 Markdown 渲染修复中。
