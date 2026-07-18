# KOC Agent 提示词汇总与效果说明

## 文档目标

本文档基于当前一期代码与 prompt 资源，汇总 KOC Agent 当前已经进入仓库的提示词资产、实际任务覆盖范围、当前 mock / model 路径的使用方式，以及仍处于一期阶段的已知限制。

这里的口径是：

- 当前仍然是一期
- prompt 资产已经进入服务器 git
- prompt 已经被 `PromptLoader` 实际加载
- 但这并不等于所有任务都已经达到稳定生产级别

## 当前 Prompt 资产

当前位于：

```text
prompts/
  persona.prompt.md
  trend-tracking.prompt.md
  xhs-content-writing.prompt.md
  general-chat.prompt.md
```

当前样例请求与效果资源位于：

```text
examples/agent-requests/
examples/agent-responses/
examples/tool-results/
```

## 当前 Prompt 总览

| Prompt 文件 | 当前覆盖任务 | 角色定位 | 当前主要输出 |
| --- | --- | --- | --- |
| `persona.prompt.md` | `persona.analyze`、`persona.follow_up` | 小红书人设策略助手 | 人设、赛道、受众、风格、追问 |
| `trend-tracking.prompt.md` | `trend.track`、`topic.recommend` | 小红书趋势分析与选题助手 | 趋势、需求、选题、推荐主题 |
| `xhs-content-writing.prompt.md` | `content.draft`、`content.revise` | 小红书图文内容撰写助手 | 标题、开头、正文、标签、改稿结果 |
| `general-chat.prompt.md` | `general.chat` | 通用对话与流程引导助手 | 普通回复、能力说明、下一步建议 |

任务到 prompt 的映射当前由 `agent/app/prompts/loader.py` 维护。

## 当前一期通用设计原则

当前 prompt 体系的共同约束仍然是：

- 一期主要面向 `platform = xiaohongshu`
- 重点面向图文内容链路
- 目标输出结构化 JSON
- 不伪造真实用户经历、真实平台数据、真实互动量
- 不直接承担后端保存职责
- 需要配合 workflow / runtime / schema 一起工作

需要特别说明：

- 当前仓库里的 prompt 是“说明型 Markdown prompt”
- 它既是团队可读文档，也是 runtime 当前直接加载的 prompt 资产
- 所以它偏长、偏解释性，这是一阶段可接受但仍有优化空间的做法

## 当前 Prompt 与代码的关系

当前生产链路里的真实关系是：

```text
workflow
→ PromptLoader.load(taskType)
→ 读取对应 Markdown prompt
→ runtime.generate(...)
```

当前行为：

- mock 路径下也会记录 `promptLoaded`
- model 路径下会把 prompt 作为 system 级提示词的一部分
- `options.promptOverride` 可以覆盖默认 prompt

## 当前一期任务覆盖情况

### 已有 Agent 任务

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `topic.recommend`
- `content.draft`
- `content.revise`

### 当前后端已接出的任务

- `general.chat`
- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `content.draft`
- `content.revise`

### 当前仍需注意的差异

- `topic.recommend` 已有 prompt、Agent 任务也已支持
- 但当前后端还没有单独暴露业务接口

## 人设 Prompt

文件：

```text
prompts/persona.prompt.md
```

覆盖：

- `persona.analyze`
- `persona.follow_up`

### 当前目标

在一期内帮助用户完成：

- 初版人设判断
- 赛道方向提炼
- 内容风格判断
- 多轮追问补充

### 当前主要输入

`persona.analyze` 当前实际依赖：

- `input.baseInfo`

`persona.follow_up` 当前实际依赖：

- `input.userMessage`
- `context.baseInfo`
- `context.conversationHistory`

### 当前主要输出

`persona.analyze`：

- `persona`
- `niche`
- `audience`
- `contentStyle`
- `referenceCreatorDirections`
- `followUpQuestions`

`persona.follow_up`：

- `reply`
- `nextQuestions`
- `isReadyToSave`
- `personaDraft`

### 当前一期效果判断

从 mock 与现有页面行为看，它当前已经能支撑一期的人设流程：

- 能生成结构化初版人设
- 能继续追问
- 能产出适合前端展示和保存的人设草案

### 当前一期限制

- `persona.follow_up` 的“何时 ready to save”仍偏经验性
- 当前后端并没有把每轮 follow-up 自动沉淀成完整长期会话
- prompt 与真实 model schema 之间还可以收得更紧

## 热门追踪 Prompt

文件：

```text
prompts/trend-tracking.prompt.md
```

覆盖：

- `trend.track`
- `topic.recommend`

### 当前目标

在一期内帮助用户：

- 看懂某一内容方向的趋势
- 理解受众需求
- 提炼可执行的选题方向

### 当前主要输入

`trend.track` 当前真实依赖：

- `input.userPreference`
- `context.savedPersona`

当前上下文中虽然有：

- `trendHistory`
- `conversationHistory`

但要注意：

- `trendHistory` 当前 builder 仍传空数组
- 所以“历史趋势上下文”概念上存在，实际上还没真正发挥作用

`topic.recommend` 当前 Agent 任务依赖：

- `context.savedPersona`
- `context.trendSnapshot`

### 当前一期效果判断

当前 mock 与 workflow 已经能完成：

- 趋势总结
- 热点方向
- 受众需求
- 选题机会
- 选题推荐

### 当前一期限制

- 当前后端主链路默认 `enableTools=false`
- 所以 prompt 虽然可以和检索结果配合，但正式业务主链路默认并不会触发真实 `web_search`
- `topic.recommend` 虽然有 prompt 和 Agent 支持，但后端未单独接出

## 内容撰写 Prompt

文件：

```text
prompts/xhs-content-writing.prompt.md
```

覆盖：

- `content.draft`
- `content.revise`

### 当前目标

在一期内帮助用户：

- 基于人设和选题生成图文草稿
- 基于修改意见继续优化草稿

### 当前主要输入

`content.draft` 当前主要依赖：

- `input.topic`
- `input.userInstruction`
- `context.savedPersona`
- `context.selectedTopic`

`content.revise` 当前主要依赖：

- `input.revisionInstruction`
- `context.currentDraft`
- `context.savedPersona`

### 当前一期效果判断

当前 mock、前端页面与后端 service 已经能支撑：

- 生成结构化草稿
- 在内容页进入聊天式改稿
- 手动保存草稿到 Mongo

### 当前一期限制

- 当前后端把 `content.revise` 复用进了 `POST /api/content/draft`
- 草稿开头字段在不同链路下仍可能出现 `hook` / `intro` 差异
- 当前仍偏一期 demo 风格，不是严格生产级 prompt 套件

## 通用聊天 Prompt

文件：

```text
prompts/general-chat.prompt.md
```

覆盖：

- `general.chat`

### 当前目标

在一期内承担：

- 普通问答
- 能力说明
- 引导用户进入人设 / 趋势 / 内容流程

### 当前实际输入

- `input.userMessage`
- `context.conversationHistory`
- `context.savedPersona`

### 当前实际输出

- `reply`
- `suggestedActions`

### 当前一期限制

- 当前聊天记录不持久化
- 后端只返回简单 `reply`
- Agent 原生 `savePayload` 没有落库链路

## 当前 Prompt 与 mock 效果的关系

当前仓库中最直接的效果参照仍然是：

- `examples/agent-responses/*.json`

它们的作用是：

- 为一期联调提供稳定结构样例
- 为 mock runtime 与测试提供可重复结果

但需要注意：

- mock 样例只能代表当前期望结构
- 不等于真实 model 路径已经完全稳定达到相同效果

## 当前一期已知不一致点

### 1. Prompt 约束和 mock 样例并不总是完全一致

例如：

- 标题候选数量
- 标签数量
- 字段命名细节

这在一期阶段是可以接受的，但需要通过文档和前端兼容层兜住。

### 2. Prompt 已覆盖的任务，不等于产品链路都已接出

最明显的是：

- `topic.recommend`

### 3. Prompt 已支持检索协同，不等于业务主链路默认会使用检索

因为当前后端默认：

```json
{
  "enableTools": false
}
```

## 当前一期的 Prompt 风险

1. Prompt 同时承担说明文档和 runtime prompt 两种角色  
   因此可读性好，但长度偏长、token 偏高。

2. Prompt 里描述了较完整的能力边界  
   但某些边界在真实代码链路里还没完全贯彻，比如工具默认不开、后端未接出某些任务。

3. Prompt 与 runtime schema 的粒度还不完全一致  
   一些任务仍然主要依赖 mock 与宽松解析。

## 当前一期建议

在仍然保持一期阶段的前提下，更适合做这些事：

1. 继续把 prompt 当作一期统一资产保留

2. 逐步把“说明型 prompt”和“运行型 prompt”分层  
   但这应作为后续优化，不必伪装成当前已完成

3. 优先补齐现有代码链路与 prompt 之间的不一致  
   比如：
   - `topic.recommend` 的业务接入
   - `content.revise` 路由表达
   - 工具开关策略

4. 增加更明确的 schema 校验与字段兼容  
   尤其是 `hook` / `intro` 这类字段差异

## 当前总结

- 当前 prompt 资产已经进入服务器 git，并且已经被代码实际引用
- 当前仍属于一期，不宜把 prompt 描述成“稳定生产级资产体系”
- 当前更准确的说法是：
  - prompt 已具备一期联调与功能演示能力
  - prompt 与 mock、workflow、runtime 已形成闭环
  - 仍需继续收敛字段一致性、任务接出完整度和工具默认策略
