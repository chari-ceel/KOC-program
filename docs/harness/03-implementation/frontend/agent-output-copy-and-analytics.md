# Agent 输出复制限制与埋点规划

本文档定义正式聊天页面体系中，Agent 输出内容的最小复制限制、官方复制按钮，以及两类埋点的 harness 规划。

覆盖范围：

- 人设打造 `profile`
- 热门追踪 `trending`
- 内容撰写 `content`
- 灵光一闪 `/?view=dialog`

本文只定义产品层面的普通交互约束和埋点口径，不把前端复制限制描述为安全边界。

## 1. 目标

当前目标分为三层：

1. 禁止用户通过普通鼠标选择、右键复制、`Ctrl+C` 复制 Agent 输出。
2. 后续只通过官方复制按钮复制 Agent 输出。
3. 官方复制按钮和对话轮次需要形成可统计的埋点数据。

限制边界：

- 可以限制普通浏览器交互路径。
- 不防 DevTools、接口抓包、截图 OCR、浏览器插件或自动化脚本。
- 如果 Agent 输出已经完整渲染到前端，用户设备侧仍存在绕过可能。

因此正式表述应为：

```text
禁止普通复制入口，并把官方复制按钮作为产品内唯一复制路径；这不是数据防泄漏安全边界。
```

## 2. 最小复制限制

### 2.1 生效对象

复制限制只作用于 Agent 输出内容。

应限制：

- assistant 文本消息
- assistant 结构化结果卡片内的文本内容
- 灵光一闪对话弹窗中的 assistant 输出

不应限制：

- 用户输入框
- 用户消息
- 登录、注册、表单字段
- 页面导航、历史卡片、保存后的业务记录详情
- 开发调试页里的 prompt 编辑区域

### 2.2 推荐实现位置

优先在公共消息气泡层实现：

- `frontend/components/ChatMessageBubble.tsx`

当前 `profile`、`trending`、`content` 三条正式业务主线的 assistant 输出主要通过该组件渲染。

灵光一闪当前还有轻量聊天入口：

- `frontend/components/ChatDialog.tsx`

如果该入口没有使用 `ChatMessageBubble`，需要在 assistant 消息渲染处单独套不可复制容器，或先收敛到公共气泡组件。

### 2.3 前端交互规则

assistant 输出容器应具备：

```tsx
onCopy={(event) => event.preventDefault()}
onContextMenu={(event) => event.preventDefault()}
onSelectStart={(event) => event.preventDefault()}
```

同时增加样式：

```css
user-select: none;
-webkit-user-select: none;
```

实现要求：

- 不做全站级 `copy` / `keydown` 拦截。
- 不拦截输入框里的复制粘贴。
- 不改变用户消息是否可复制。
- 不改变 Agent 输出的视觉排版。

## 3. 官方复制按钮

官方复制按钮是后续唯一被产品承认的复制路径。

推荐接入点：

- `frontend/components/MessageActions.tsx`

按钮触发时：

1. 优先使用 `navigator.clipboard.writeText(...)` 写入剪贴板。
2. 如果部署环境不是安全上下文，前端必须回退到隐藏 `textarea` + `document.execCommand('copy')`，保证普通 `http` 环境也能复制。
3. 复制成功后才上报 `agent_output_copy` 埋点。

按钮布局规则：

- 复制按钮必须复用 `MessageActions` 的圆形图标按钮样式，不单独做文字按钮。
- 当同一条消息同时存在刷新、复制、保存三个动作时，顺序固定为：刷新、复制、保存。
- 复制按钮位于刷新和保存之间。
- 三个按钮之间的水平间距保持一致。
- 第一版图标允许先用 emoji 占位，但交互尺寸、hover、disabled 态必须与刷新/保存按钮一致。

按钮可用规则：

- 只对 assistant 消息展示。
- 生成中消息不展示或禁用复制。
- 错误态、停止态等系统状态消息默认不展示复制按钮，除非后续明确要求。
- 复制结构化结果时，应复制面向用户可读的最终文本，而不是组件内部 JSON。

## 4. 埋点总原则

第一版埋点只记录行为元数据，不记录用户输入正文和 Agent 输出正文。

统一原则：

- `userId` 由后端从 session cookie 解析，不接受前端传入作为可信身份。
- `createdAt` 由后端生成。
- 前端可以传 `conversationId`、`messageId`、`requestId` 等客户端生成 ID。
- 默认不存完整 prompt、用户消息正文、Agent 回复正文。
- 如需排查重复复制，可存内容 hash，但默认只要求 `contentLength`。

推荐后端入口：

```text
POST /api/analytics/events
```

推荐存储：

```text
Mongo database: koc_agent_analytics
Mongo collection: analytics_events
```

## 5. 埋点一：复制频率与复制板块

事件名：

```text
agent_output_copy
```

触发时机：

- 用户点击官方复制按钮，且剪贴板写入成功后上报。

第一版不记录被拦截的 `Ctrl+C` 或鼠标复制尝试，因为这些事件噪音高，且无法稳定说明真实复制意图。

### 5.1 字段

```json
{
  "eventName": "agent_output_copy",
  "module": "dialog",
  "conversationId": "client-generated-uuid",
  "messageId": "client-generated-uuid",
  "messageIndex": 3,
  "messageRole": "assistant",
  "contentLength": 1280,
  "contentHash": "optional-sha256",
  "copySource": "message_action_button"
}
```

后端补充字段：

```json
{
  "userId": "session-user-id-or-null",
  "isAuthenticated": true,
  "createdAt": "server-time",
  "requestIpHash": "optional",
  "userAgent": "optional"
}
```

### 5.2 `module` 枚举

| module | 页面 | 含义 |
| --- | --- | --- |
| `dialog` | `/?view=dialog` | 灵光一闪 / 通用聊天 |
| `profile` | `/profile` | 人设打造 |
| `trending` | `/trending` | 热门追踪 |
| `content` | `/content` | 内容撰写 |

### 5.3 可统计指标

该事件至少应支持：

- 按用户统计复制次数。
- 按模块统计复制次数。
- 按日期统计复制趋势。
- 按 `conversationId` 统计单次会话内复制次数。
- 按 `messageId` 统计同一条 Agent 输出被复制次数。

## 6. 埋点二：对话轮次监控

事件名：

```text
conversation_turn_started
conversation_turn_completed
conversation_turn_failed
```

触发时机：

- `conversation_turn_started`：用户点击发送，前端准备请求业务接口时。
- `conversation_turn_completed`：业务接口成功返回并生成 assistant 消息后。
- `conversation_turn_failed`：业务接口失败、超时、被用户停止或请求异常时。

### 6.1 字段

```json
{
  "eventName": "conversation_turn_completed",
  "module": "content",
  "conversationId": "client-generated-uuid",
  "turnIndex": 4,
  "requestId": "client-generated-uuid",
  "taskType": "content.draft",
  "userMessageLength": 42,
  "assistantMessageLength": 1680,
  "historyMessageCount": 8,
  "status": "success",
  "latencyMs": 3200
}
```

后端补充字段同复制事件：

```json
{
  "userId": "session-user-id-or-null",
  "isAuthenticated": true,
  "createdAt": "server-time"
}
```

### 6.2 `taskType` 映射

| module | 前端/后端入口 | taskType |
| --- | --- | --- |
| `dialog` | `POST /api/chat` | `general.chat` |
| `profile` 首轮 | `POST /api/persona/analyze` | `persona.analyze` |
| `profile` 追问 | `POST /api/persona/follow_up` | `persona.follow_up` |
| `trending` | `POST /api/trends/track` | `trend.track` |
| `content` | `POST /api/content/draft` | `content.draft` |

### 6.3 轮次定义

一轮对话定义为：

```text
一次用户提交 + 一次 Agent 尝试返回
```

即使失败或停止，也应计入一次 attempted turn。

推荐计算：

- `turnIndex` 从 1 开始。
- 以前端当前会话内用户消息数量作为主要依据。
- 刷新恢复 session 后继续沿用当前会话已有轮次。
- 新建 `conversationId` 时重新从 1 开始。

### 6.4 可统计指标

该事件至少应支持：

- 总对话轮次。
- 人均对话轮次。
- 各模块轮次分布。
- 各模块失败率。
- 平均响应耗时。
- 中断/停止比例。
- 单会话平均轮次。

## 7. 后端接口规划

第一版可以使用单一事件接收接口：

```text
POST /api/analytics/events
```

请求体：

```json
{
  "eventName": "agent_output_copy",
  "module": "content",
  "conversationId": "client-generated-uuid",
  "messageId": "client-generated-uuid",
  "messageIndex": 3,
  "messageRole": "assistant",
  "contentLength": 1280,
  "copySource": "message_action_button"
}
```

返回：

```json
{
  "code": 200,
  "data": {
    "accepted": true
  }
}
```

接口规则：

- 登录用户：记录 `userId`。
- 游客：允许记录匿名事件，`userId` 为空或写入匿名会话标识。
- 非法 `eventName` 或非法 `module` 返回 400。
- 超大请求体直接拒绝。
- 单条事件失败不应阻塞用户主流程，前端只记录 console warning。

## 8. Mongo 规划

集合：

```text
koc_agent_analytics.analytics_events
```

推荐索引：

```text
created_at
user_id + event_name + created_at
module + event_name + created_at
conversation_id + created_at
request_id
```

字段命名建议与当前后端 Python 风格一致，落库时使用 snake_case：

```json
{
  "event_name": "agent_output_copy",
  "module": "content",
  "conversation_id": "client-generated-uuid",
  "message_id": "client-generated-uuid",
  "request_id": null,
  "task_type": null,
  "user_id": "session-user-id",
  "is_authenticated": true,
  "payload": {
    "message_index": 3,
    "message_role": "assistant",
    "content_length": 1280,
    "copy_source": "message_action_button"
  },
  "created_at": "server-time"
}
```

## 9. 验收标准

复制限制验收：

- assistant 输出无法被鼠标拖选。
- assistant 输出右键菜单不出现或不能复制。
- 聚焦 assistant 输出区域时，`Ctrl+C` 无法复制其文本。
- 输入框、用户消息和表单字段仍能正常复制粘贴。
- 页面视觉无明显变化。

复制按钮埋点验收：

- 点击官方复制按钮后，剪贴板内容正确。
- 后端收到 `agent_output_copy`。
- 数据能区分 `dialog/profile/trending/content`。
- 数据不包含 Agent 输出正文。

对话轮次埋点验收：

- 每次用户提交至少产生一条 `conversation_turn_started`。
- 成功返回后产生 `conversation_turn_completed`，并包含 `latencyMs`。
- 失败、超时或停止时产生 `conversation_turn_failed`。
- 数据可按用户、模块、日期聚合。

## 10. 最小实施顺序

1. 在 assistant 输出容器加复制限制。
2. 给 assistant 消息增加官方复制按钮。
3. 新增 `POST /api/analytics/events` 和 analytics Mongo 集合。
4. 复制按钮上报 `agent_output_copy`。
5. 四个聊天入口上报 `conversation_turn_started/completed/failed`。
6. 补前端交互测试和后端 analytics 接口测试。

## 11. 当前不做

第一版不做：

- 全站级禁止复制。
- 记录用户输入正文。
- 记录 Agent 输出正文。
- 记录被拦截复制尝试。
- 用前端限制承诺防泄漏。
- 把 analytics 事件写进 persona/trend/content 业务集合。
