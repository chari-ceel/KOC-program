# 人设打造 Workflow

## 目标

人设打造 workflow 用于帮助小白自媒体博主明确：

- 账号人设
- 适合赛道
- 目标受众
- 内容风格
- 可继续追问的问题
- 可保存的人设结果

一期对应两个任务：

```text
persona.analyze
persona.follow_up
```

## 输入边界

### `persona.analyze`

用于用户首次提交基础信息。

必需 `input`：

```json
{
  "baseInfo": {
    "gender": "女",
    "age": 21,
    "occupation": "大学生",
    "interests": ["学习", "穿搭", "拍照"],
    "skills": ["做计划", "整理资料"],
    "goals": ["涨粉", "记录成长"]
  }
}
```

可选 `context`：

```json
{
  "personaHistory": []
}
```

### `persona.follow_up`

用于用户在人设打造对话中继续回答。

必需 `input`：

```json
{
  "userMessage": "我比较擅长做计划，也经常帮同学整理考证资料。"
}
```

必需 `context`：

```json
{
  "baseInfo": {},
  "conversationHistory": []
}
```

可选 `context`：

```json
{
  "personaHistory": []
}
```

## 处理流程

### `persona.analyze` 流程

```text
1. 校验 input.baseInfo 是否存在。
2. 提取用户基础画像：
   - 年龄阶段
   - 职业/身份
   - 兴趣
   - 技能
   - 目标
3. 判断信息是否足够生成初步人设。
4. 生成 1 个主推荐人设。
5. 生成主赛道和 2-3 个辅助方向。
6. 生成目标受众。
7. 生成内容风格。
8. 生成头部博主参考方向，不生成具体不可验证账号。
9. 生成 2-3 个追问问题。
10. 返回 data 和 savePayload。
```

补充约束：

- 人设打造初始页的首条业务输入，必须直接进入结构化结果路径。
- 该轮不允许退回纯讨论态；即使用户只填写了基础表单，也必须基于这份基础信息输出一版可展示的初版人设。
- 这一轮的结构化结果就是聊天页首条 assistant 结果，也是当前会话里第一次允许出现保存按钮的时机。

### `persona.follow_up` 流程

```text
1. 校验 input.userMessage 是否存在。
2. 读取 baseInfo 和 conversationHistory。
3. 先判断本轮属于“讨论态”还是“重新进入结构化阶段”。
4. 判断用户新回答补充了哪些信息：
   - 性格
   - 经历
   - 擅长解决的问题
   - 内容表达偏好
   - 商业或成长目标
5. 如果只是补充想法、解释偏好、追问原因、缩小方向、调整表达重点，且本轮没有形成完整 `personaDraft`，默认按讨论态处理：
   - 优先返回自然 reply
   - 只返回 nextQuestions
   - 不要求输出新的完整 personaDraft
   - 不出现保存按钮
6. 只有当用户明确要求“重新整理一版 / 更新一版人设 / 给我一版新的人设 / 定稿 / 保存 / 就按这个来”，或上下文已经足够明确且本轮确实需要重新汇总人设时，才重新进入结构化阶段。
7. 进入结构化阶段后，再更新 personaDraft。
8. 判断是否已足够保存。
9. 如果 `personaDraft` 不完整，继续生成 nextQuestions，并保持讨论态。
10. 如果 `personaDraft` 已完整，即使仍给出 nextQuestions 作为可选继续完善问题，也应返回 isReadyToSave = true，并进入结构化人设态。
11. 返回本轮 reply、nextQuestions、personaDraft 和 savePayload。
```

### 人设 follow-up 结果态约定

人设 follow-up 只允许两类可见结果态：

- 讨论态
- 结构化人设态

判定口径：

- 用户从初始页第一次进入聊天页时，固定为结构化人设态。
- 后续普通交流默认是讨论态。
- 只有当 Agent 明确判断“本轮需要重新汇总当前人设”时，才再次进入结构化人设态。
- 如果本轮已经形成完整 `personaDraft`，则优先视为结构化人设态；`nextQuestions` 只是“可继续完善的问题”，不表示当前结果不可保存。

属于讨论态的常见输入：

- “我想突出我在绘画上的专业性”
- “我更想偏教程一点”
- “为什么你刚才建议这个方向”
- “这个方向会不会太窄”
- “能不能换个更真实的说法”

属于重新进入结构化阶段的常见输入：

- “基于刚才这些，重新整理一版人设”
- “那你给我更新一版完整定位”
- “好，就按这个方向定稿”
- “给我最终版，我要保存”

额外约束：

- 讨论态不应机械重复上一轮已经完整展示过的人设草稿。
- 如果本轮 reply 明确表示“还需要继续了解具体信息”，且 `personaDraft` 不完整，则默认不应把这条消息当成新的结构化保存节点。
- 如果本轮同时给出了完整 `personaDraft` 和 `nextQuestions`，前端应完整展示 `nextQuestions`，保存按钮仍跟随结构化人设态出现。
- 保存按钮只能跟随结构化人设态出现；讨论态消息下不展示保存按钮。

### 完整 `personaDraft` 最低标准

用于判定“可以保存”的 `personaDraft` 至少应同时覆盖：

- `persona.name` 或 `persona.description`
- `niche.primary` 或 `niche.secondary`
- `audience`
- `contentStyle`

只有零散字段、阶段性想法或空结构时，即使存在 `personaDraft` 字段，也仍应按讨论态处理。

## 工具调用

一期不调用外部工具。

原因：

- 人设打造主要依赖用户输入和模型推理。
- PRD 中也标注该部分重难点较低，设计好信息传入与 prompt 即可。

后续可选工具：

- 查询历史人设相似案例。
- 查询平台赛道分类。
- 查询内置人设模板库。

这些后续工具必须通过统一工具协议接入。

## 输出结构

### `persona.analyze` 输出

```json
{
  "persona": {
    "name": "大学生成长型学习博主",
    "description": "以真实校园经验、学习规划和低成本成长方法为核心的人设"
  },
  "niche": {
    "primary": "大学生成长",
    "secondary": ["学习规划", "考证经验", "生活效率"]
  },
  "audience": ["大学生", "考证人群", "想提升效率的新手"],
  "contentStyle": ["真实", "经验分享", "少说教", "可操作"],
  "referenceCreatorDirections": ["大学生成长类博主", "学习规划类博主"],
  "followUpQuestions": [
    "你最常被同学咨询的问题是什么？",
    "你更想分享经验、踩坑记录还是具体教程？"
  ]
}
```

### `persona.follow_up` 输出

```json
{
  "reply": "你的优势比较适合做大学生成长 + 学习规划方向。",
  "nextQuestions": [
    "你更希望内容偏学习规划、考证经验，还是校园生活效率？"
  ],
  "isReadyToSave": true,
  "personaDraft": {
    "persona": {},
    "niche": {},
    "audience": []
  }
}
```

人设描述字段约束：

- `persona.description` 与 `personaDraft.persona.description` 必须写成可直接展示的账号定位摘要。
- 不得写成人物小传、第三人称介绍或旁白式说明。
- 禁止出现“她”“他”“TA”“用户”这类第三人称或泛指称呼。
- 优先使用无人称表达，直接概括账号会持续分享什么、强调什么、适合吸引什么样的人。
- 不要写成“她希望… / 他想… / 用户适合… / TA 会…”这类句式。

讨论态示例：

```json
{
  "reply": "你如果想突出绘画专业性，方向会更聚焦，也更容易吸引到真正想学技法和看创作过程的人。下一步更关键的是先确认你想突出的是基础教学、进阶技法，还是个人创作表达。",
  "nextQuestions": [
    "你更想强调绘画教学、创作过程，还是作品背后的理解？"
  ],
  "isReadyToSave": false
}
```

结构化态示例：

```json
{
  "reply": "我先基于你刚补充的内容，把当前人设重新整理成一版更聚焦绘画专业性的结构。",
  "nextQuestions": [
    "你更想让这个账号偏绘画教学，还是偏创作过程记录？"
  ],
  "isReadyToSave": true,
  "personaDraft": {
    "persona": {
      "name": "专业绘画成长记录者",
      "description": "围绕绘画学习、创作过程和作品表达持续分享可理解、可参考的成长内容。"
    },
    "niche": {
      "primary": "绘画成长",
      "secondary": ["创作过程", "作品表达"]
    },
    "audience": ["绘画学习者", "喜欢看创作过程的人"],
    "contentStyle": ["真实", "专业", "温和"]
  }
}
```

这种结构化态允许保存；`nextQuestions` 只表示后续还可以继续优化。

## 保存建议

### `persona.analyze`

```json
{
  "type": "persona_result",
  "suggestedCollection": "persona_results",
  "data": {}
}
```

### `persona.follow_up`

```json
{
  "type": "persona_conversation_turn",
  "suggestedCollection": "persona_conversations",
  "data": {}
}
```

说明：

- Agent 不直接保存数据。
- 后端根据 `savePayload` 决定是否落库。
- 如果用户点击“保存人设”，后端应保存最终 `personaDraft`。

## 保存后重入

人设打造初始页允许展示已保存人设的概要图，但这张概要图只承担快速识别职责，不是完整人设正文。

### 初始页概要图

概要图可以从已保存人设中抽取短字段，例如：

- 人设定位
- 基础画像
- 关键词
- 目标受众
- 内容语气
- 保存时间

约束：

- 概要图字段必须保持短语级展示。
- 概要图不得替代完整结构化人设。
- 前端不得从概要图反推、补写或重新总结完整人设。

### “继续完善”入口

当用户在初始页已读取到保存的人设时，可以在概要图右下角提供“继续完善”按钮。

点击“继续完善”后的行为必须是本地恢复行为：

1. 读取上一次保存的完整结构化人设数据。
2. 切换到人设聊天态。
3. 在聊天流中只放入一条 assistant 消息，用于重新展示这份已保存结构化人设草稿。
4. 不调用 `persona.analyze`。
5. 不调用 `persona.follow_up`。
6. 不要求 Agent 重新整理、重新总结或补写字段。

这条 assistant 消息的展示内容必须来自保存时已有的结构化人设字段，例如：

- `persona`
- `niche`
- `audience`
- `contentStyle`
- `referenceCreatorDirections`
- `basicInfo`
- `keywords`
- `personaPosition`
- `contentTone`

如果某个字段在保存数据中不存在，前端应缺省不展示；不得为了补齐版面而生成新内容。

### 重入展示边界

从“继续完善”进入聊天态时：

- 只展示保存的人设结构化草稿本体。
- 不展示保存对象里的历史 `conversation`。
- 不展示“后续可继续补充问题”。
- 不展示 `nextQuestions` 或 `followUpQuestions`。
- 不展示概要图短字段本身，除非这些短字段原本就是完整保存数据中的正式结构字段。
- 不把保存成功提示、概要图、卡片预览或旧对话历史写入当前聊天流。

用户在该状态下继续输入修改意见时，才进入正常 `persona.follow_up` 流程。此时上下文应基于这条已保存结构化人设消息和用户新输入继续，而不是先让 Agent 重新生成一版人设。

## 错误和降级

### 缺少基础信息

条件：

```text
persona.analyze 缺少 input.baseInfo
```

返回：

```json
{
  "status": "failed",
  "error": {
    "code": "INVALID_REQUEST",
    "message": "缺少用户基础信息。"
  }
}
```

### 信息不足

条件：

```text
用户基础信息过少，不足以生成可靠人设
```

返回：

```json
{
  "status": "partial_success",
  "data": {
    "persona": null,
    "followUpQuestions": ["请补充你的兴趣爱好和擅长技能。"]
  },
  "warnings": [
    {
      "code": "INSUFFICIENT_PROFILE_INFO",
      "message": "当前信息不足，建议先补充更多个人信息。"
    }
  ]
}
```

## 约束

- 不编造具体头部博主账号。
- 不承诺一定涨粉。
- 不输出医疗、金融、法律等高风险建议。
- 不把用户描述武断归类为单一人格标签。
- 不输出不可保存的散文式结果，必须结构化。

## 一期验收标准

- `persona.analyze` 能根据基础信息返回结构化人设。
- `persona.analyze` 能返回 2-3 个追问问题。
- `persona.follow_up` 能根据用户补充回答更新人设草案。
- 信息不足时能返回追问，而不是强行生成确定结论。
- 返回中包含可供后端保存的 `savePayload`。
