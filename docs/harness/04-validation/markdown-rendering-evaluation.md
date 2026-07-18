# Markdown 渲染排查与评测方案

## 目标

本文档定义当前 KOC 如何排查和评测 Markdown 渲染问题。

当前阶段的重点不是改消息模型，也不是引入 `parts`、tool 展示或 reasoning 展示，而是先把用户实际看到的正文文本和结构化结果里的正文文本稳定渲染出来。

需要特别区分两类内容：

- 正文 Markdown：普通对话文本、用户输入展示、人设正文、内容草稿的 `hook` / `body` / `ending`、热门追踪中的说明性正文等。
- 概要短字段：`cardPreview` / 概要图字段，只服务初始页卡片快速扫读，检查短、准、结构稳定，不按正文 Markdown 渲染。

## 当前链路

Markdown 正文的最小链路是：

```text
原始文本 -> normalizeAiMarkdown() -> MarkdownText -> DOM 结果
```

四段含义如下。

`原始文本`：

- 来自 Agent JSON 字符串字段、后端包装字段、页面拼接字段或用户输入。
- 普通对话里通常是 `message.content`。
- 内容草稿里可能是 `completeDraft.hook`、`completeDraft.body[]`、`completeDraft.ending`。
- 热门、人设场景里可能是结构化结果中的说明性字段。
- `cardPreview` 也是 Agent / 后端返回字段，但它不是正文 Markdown。
- 后端可能额外生成 `data.text` 作为导语或兜底说明，内容撰写、热门追踪、人设场景都可能存在这种包装文本。
- 前端保存时也可能保存结构化正文的字符串版本，例如内容草稿的 `body` 与 `structured.body` 同时存在。

`normalizeAiMarkdown()`：

- 位置：[markdown-normalize.ts](../../../../frontend/lib/markdown-normalize.ts)
- 职责是轻量修正 AI 常见非标准 Markdown。
- 可以处理换行、tab、坏代码围栏、列表与加粗粘连、标题黏连正文、悬空星号等。
- 不负责生成业务字段，不从正文抽取 `cardPreview`，不判断某段文本是不是草稿或热门结果。

`MarkdownText`：

- 位置：[MarkdownText.tsx](../../../../frontend/components/MarkdownText.tsx)
- 职责是调用 `react-markdown + remark-gfm`，并注册标题、段落、列表、代码块、链接等展示组件。
- 它负责渲染和样式，不负责理解业务语义。

`DOM 结果`：

- 指浏览器最终生成的 HTML 结构。
- 调试时重点看 `p`、`ul`、`ol`、`li`、`h1` 到 `h3`、`pre code`、`a`、`table` 等是否符合预期。
- DOM 对了不代表视觉一定完美，但 DOM 错了基本能说明 Markdown 解析或归一化有问题。

## 问题归因

### `*` 单独一行

常见现象：

```md
*
实际内容在下一行
```

优先判断：

- 原始文本里已经有孤立 `*`：模型输出问题。
- `normalize` 后仍保留孤立 `*`：归一化覆盖不足。
- 原始结构化字段被页面拆成多个段落后才出现：字段拆分或重组问题。
- DOM 里出现空 `li`：Markdown 解析把坏星号当成列表。

当前更可能的主因是模型输出不稳定，次因是 `normalizeAiMarkdown()` 只能补救部分坏格式。

### `**` 泄露

常见现象：

```md
这是 **未闭合的加粗
```

优先判断：

- 原始文本里 `**` 不成对：模型输出问题。
- normalize 后仍不成对：归一化保守或缺规则。
- DOM 文本里直接显示 `**`：渲染器只是如实显示残留坏标记。

不要把这类现象直接归因给 `ReactMarkdown`。不完整 Markdown 显示成文本是正常行为。

### `，。` 或重复标点

常见现象：

```text
这个方向适合新手，。
```

优先判断：

- 单个字段原文已经包含 `，。`：模型输出问题。
- 后端或页面先用逗号连接，再给片段统一补句号：拼接问题。
- 字段本身已有句号，外层再次补句号：拼接问题。

这类问题通常不属于 Markdown 渲染器，也不应主要靠 `normalizeAiMarkdown()` 解决。更合适的处理点是后端服务或页面格式化函数的句尾策略。

### 句末有的有 `。` 有的没有

优先判断：

- 结构化字段来自不同来源，有的保留模型原句，有的由后端补句号。
- 页面把 `body` 按换行拆开后逐段展示，段落句尾策略不一致。
- `cardPreview` 兜底从正文短语抽取时混入了正文标点。

当前项目主链路是 `fetch -> response.json()`，不是 SSE 或逐 token 渲染。因此这类现象更像拼接与字段规范问题，不像真实流式截断。

## 排查流程

遇到 Markdown 展示异常时，按下面顺序看证据。

1. 记录原始字段路径

先确认问题来自哪个字段：

- `message.content`
- `completeDraft.hook`
- `completeDraft.body[n]`
- `completeDraft.ending`
- `completeAnalysis.trends`
- `personaDraft.persona.description`
- `cardPreview.keywords`

如果字段是 `cardPreview`，不要进入正文 Markdown 判断，改查概要字段规则。

常见字段路径：

| 场景 | 正文 Markdown 字段 | 概要字段 |
| --- | --- | --- |
| 通用聊天 | `message.content`、`reply` | 无 |
| 内容撰写 | `completeDraft.hook`、`completeDraft.body[]`、`completeDraft.ending`、`message.content` 导语 | `completeDraft.cardPreview.keywords` |
| 热门追踪 | `message.content`、`completeAnalysis` 内说明性文本 | `completeAnalysis.cardPreview.discoveryKeywords`、`completeAnalysis.cardPreview.shortTopics` |
| 人设打造 | `reply`、`persona.description`、`personaDraft.persona.description` | `personaDraft.cardPreview` |

2. 对比原始文本和 normalize 后文本

看：

- 是否存在孤立 `*`、`**`、`-`、`1.`
- 是否有 `1、`、`（1）`、`•`
- 是否有未闭合代码块
- 是否有 `，。`、`。。`
- 是否有标题和正文黏在同一行

3. 看 DOM 结构

正文 Markdown 重点看：

- 列表是否真的生成 `ul` / `ol` / `li`
- 标题是否生成 `h1` / `h2` / `h3`
- 代码块是否生成 `pre code`
- 表格是否生成 `table`
- 链接是否生成 `a` 且外链属性正确

4. 回到拼接层

如果 normalize 前后都没有明显 Markdown 问题，但展示文本有重复标点或句尾不一致，应检查：

- 后端服务是否给字段统一补标点
- 前端是否把结构化对象重新拼成文本
- 保存 / 恢复时是否再次清洗或重组字段

## 分层定位

### 模型输出层

判断依据：

- 接口响应的 `data.raw` 或 Agent 返回结构里已经存在坏 Markdown、`，。`、半截 `**`。
- prompt 已要求标准 Markdown，但模型仍输出不合规字符串。

修复方向：

- 加强 prompt 的展示字符串约束。
- 在 Agent / 后端层增加展示字段校验或降级。
- 对可保存结构化结果，优先保证结构字段干净，而不是只依赖前端兜底。

### 后端拼接层

判断依据：

- `data.raw` 正常，但后端返回的 `data.text`、兜底说明或保存 payload 文本异常。
- 重复标点、句尾补 `。`、字段连接符不一致通常出现在这一层。

修复方向：

- 统一句尾策略：字段原文已有终止标点时不再追加。
- 拼接自然语言前先清理字段尾部标点。
- 不从长正文截断生成新的 `cardPreview` 主路径。

### 前端拼接层

判断依据：

- 结构化字段正常，但 `message.content`、`assistantText` 或保存后的字符串异常。
- `DraftRenderer` 展示正常，但保存后重新打开异常，说明字符串版本和结构化版本不一致。

修复方向：

- 检查 `stringifyDraft()`、`normalizeAgentDraft()`、`cleanMarkdownText()` 等页面格式化函数。
- 结构化正文由结构化 renderer 展示，导语和正文不要重新拼成一整段 Markdown。
- `cardPreview` 只作为短字段消费，不从正文 renderer 反推。

### normalize 层

判断依据：

- 原始文本有轻微 Markdown 瑕疵，经过 `normalizeAiMarkdown()` 后仍泄露坏符号。
- 或合法 Markdown 被 normalize 破坏，例如 `***` 分割线、代码块、嵌套列表。

修复方向：

- 只补语法归一规则，不做业务字段生成。
- 优先补行首规则，避免误伤正文中的中文标点。
- 对 fenced code block 先保护再清洗。

### DOM / 渲染层

判断依据：

- normalized 字符串已经正确，但 DOM 没有生成预期结构。
- 例如表格没有 `table`，列表没有 `li`，代码块没有 `pre code`。

修复方向：

- 检查 `MarkdownText` 组件映射。
- 检查 `remark-gfm` 是否覆盖对应语法。
- 对表格、task list、代码块补稳定展示组件或样式。

### 存储恢复层

判断依据：

- 首次生成展示正常，刷新页面、打开历史记录或草稿后异常。
- 保存数据中 `body`、`structured.body`、`cardPreview` 不一致。

修复方向：

- 对比保存接口 payload 和历史接口返回。
- 新数据以结构化字段为准，字符串 `body` 只作为兼容展示或全文备份。
- 缺少 `cardPreview` 的旧数据只做短语级兜底，不改变新结果主路径。

## 评测范围

一期纳入：

- 普通对话文本。
- 用户输入展示。
- 人设页当前文本化结果。
- 内容草稿结构化正文，包括 `hook`、`body`、`ending`。
- 热门追踪结构化正文中的说明性文本。
- `cardPreview` / 概要字段稳定性检查。

一期不纳入：

- tool 调用展示。
- reasoning / 思考过程展示。
- 未来 `parts` 消息模型。
- HTML 白名单、KaTeX、Mermaid、代码高亮。
- 流式 Markdown 半截渲染。

## Fixture 格式

正文 Markdown fixture 建议使用：

```json
{
  "id": "content-draft-body-001",
  "scenario": "content",
  "surface": "structured_body",
  "fieldPath": "completeDraft.body[0]",
  "input": "1、**先明确目标：**不要一上来就囤资料",
  "expected": {
    "normalizedIncludes": ["1.", "先明确目标"],
    "dom": {
      "requiredText": ["先明确目标", "不要一上来就囤资料"],
      "requiredSelectors": ["ol", "li"],
      "forbiddenText": ["1、**"]
    }
  }
}
```

`cardPreview` fixture 建议使用：

```json
{
  "id": "content-card-preview-001",
  "scenario": "content",
  "surface": "card_preview",
  "fieldPath": "completeDraft.cardPreview.keywords",
  "input": ["#低成本自律。真的很适合大学生", "任务拆解，三步法", "小红书方法"],
  "expected": {
    "type": "stringArray",
    "maxItems": 3,
    "maxCharsEach": 14,
    "forbiddenMarkdownTokens": ["#", "**", "- ", "```"]
  }
}
```

## 第一批 Fixture 清单

建议第一批先落 24 条。

| id | 场景 | 输入重点 | 期望重点 |
| --- | --- | --- | --- |
| MD-FX-001 | 普通对话 | 孤立 `*` | 删除孤立星号，不生成空列表项 |
| MD-FX-002 | 普通对话 | 孤立 `**` | 删除孤立双星号，不泄露文本 |
| MD-FX-003 | 普通对话 | 句尾坏星号 | 删除句尾悬空星号 |
| MD-FX-004 | 普通对话 | `*正文` 半截强调 | 不误变列表，正文可读 |
| MD-FX-005 | 普通对话 | 合法 `**加粗**` | 保留并渲染加粗 |
| MD-FX-006 | 普通对话 | `-**标题：**正文` | 补空格并保留列表结构 |
| MD-FX-007 | 普通对话 | `1、` 中文编号 | 行首归一为有序列表 |
| MD-FX-008 | 普通对话 | `（1）` 中文编号 | 行首归一为有序列表 |
| MD-FX-009 | 普通对话 | `•` 圆点列表 | 转为标准无序列表 |
| MD-FX-010 | 普通对话 | 中文标点 | 不被星号/列表规则误伤 |
| MD-FX-011 | 普通对话 | 标题黏连正文 | 标题前补换行 |
| MD-FX-012 | 普通对话 | 常见章节标签 | 小节结构可读 |
| MD-FX-013 | 普通对话 | fenced code block | 代码块内符号不被清洗 |
| MD-FX-014 | 普通对话 | 伪代码围栏 | 稳定为代码块 |
| MD-FX-015 | 普通对话 | GFM 表格 | 生成表格结构 |
| MD-FX-016 | 普通对话 | task list | 任务列表展示稳定 |
| MD-FX-017 | 内容草稿正文 | `body[]` 含 `1、` | 草稿正文也归一为列表 |
| MD-FX-018 | 内容草稿正文 | `body[]` 含坏星号 | 删除坏符号，保留合法加粗 |
| MD-FX-019 | 内容草稿正文 | `body[]` 含表格 | 结构化正文也支持表格 |
| MD-FX-020 | 内容草稿正文 | `body[]` 含 task list | 结构化正文能力与聊天一致 |
| MD-FX-021 | 内容 `cardPreview` | `keywords` 含 `#` / 长句 | 短字段清洁，不按正文 Markdown |
| MD-FX-022 | 热门 `cardPreview` | `discoveryKeywords` / `shortTopics` | 短语化，不从正文截长文 |
| MD-FX-023 | 人设 `cardPreview` | 短标签含 Markdown / 标点 | 清理为卡片短字段 |
| MD-FX-024 | 结构化边界 | `text` + `completeDraft.body` | 导语和结构化正文分开渲染 |

## Runner 设计

最小控制台 runner：

```text
node frontend/scripts/markdown-render-eval.mjs
```

职责：

- 读取 fixture。
- 对正文 fixture 执行 `normalizeAiMarkdown()`。
- 检查 `normalizedIncludes`、`forbiddenText`。
- 通过 Playwright 或 React 测试环境渲染 `MarkdownText`，检查 DOM selector。
- 对 `cardPreview` fixture 只做结构、长度、非法 Markdown token 检查。
- 有失败时输出 fixture id、字段路径、原始值、归一化值、失败断言，并以非 0 退出。

当前第一阶段已落地：

- fixture 文件：`frontend/fixtures/markdown-rendering/first-pass.json`
- runner：`frontend/scripts/markdown-render-eval.mjs`
- npm 入口：在 `frontend/` 下执行 `npm run test:markdown`
- 已覆盖正文 Markdown、结构化草稿正文、`cardPreview` 短字段和结构化边界四类 surface。
- 暂时标记为 `pending` 的 fixture 包括圆点列表、列表符号与加粗粘连、表格 DOM、task list DOM。这些是后续阶段的回归目标，不阻塞第一阶段 runner。

## 调试页设计

后续可以增加仅开发使用的调试页，例如：

```text
/prompt-debug/markdown
```

页面展示：

- fixture 选择或手工输入。
- 原始文本。
- normalize 后文本。
- 正式 `MarkdownText` 渲染预览。
- DOM / 文本断言结果。
- `cardPreview` fixture 的长度、非法 token、空值检查。

这个页面只服务排查，不是正式产品入口。

## 截图边界

一期优先 DOM 检查，不默认做截图。

适合截图检查：

- 表格横向溢出。
- 长代码块滚动。
- 长列表缩进。
- 结构化草稿正文在移动端布局异常。

不适合截图检查：

- `normalize` 输出是否正确。
- 链接属性是否存在。
- `cardPreview` 长度和 token 检查。
- 文本是否包含某个关键词。

## 后续落地顺序

1. 先把本文档纳入 harness 验证体系。
2. 建立 fixture 文件和最小控制台 runner。
3. 用真实问题回放补充 fixture。
4. 给 `MarkdownText` 增加必要的 DOM 断言。
5. 只在视觉问题明确时补截图。

## 触发执行时机

修改以下任一位置后，应执行 Markdown 渲染评测：

- [markdown-normalize.ts](../../../../frontend/lib/markdown-normalize.ts)
- [MarkdownText.tsx](../../../../frontend/components/MarkdownText.tsx)
- 内容草稿 `DraftRenderer` 或草稿字段清洗逻辑
- 热门追踪、人设、内容撰写的后端文本拼接逻辑
- `cardPreview` 生成、保存、恢复或前端兜底逻辑
- prompt 中展示字符串 Markdown 契约
