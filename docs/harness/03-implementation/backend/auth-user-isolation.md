# 后端 Auth 与用户隔离 Harness 规范

## 目标

本文档用于定义 KOC 项目部署到服务器并开放多账号使用时，后端在登录、session、业务数据隔离和 Agent 调用上的 harness 规则。

覆盖对象：

- [backend/app/services/auth.py](../../../../backend/app/services/auth.py)
- [backend/app/endpoints/web/auth.py](../../../../backend/app/endpoints/web/auth.py)
- [backend/app/endpoints/web/persona.py](../../../../backend/app/endpoints/web/persona.py)
- [backend/app/endpoints/web/trends.py](../../../../backend/app/endpoints/web/trends.py)
- [backend/app/endpoints/web/content.py](../../../../backend/app/endpoints/web/content.py)
- [backend/app/adapters/agent/builder.py](../../../../backend/app/adapters/agent/builder.py)

本文档约束的是：

- Auth API 的边界
- session cookie 的使用方式
- 业务接口如何识别当前用户
- 哪些接口允许游客访问
- 哪些接口必须登录
- 路径和请求体中的 `userId` 如何处理
- 后端向 Agent 传递 `userId` 的规则
- 生产环境 debug route 的禁用要求

## 总体原则

后端是用户身份和业务数据隔离的唯一可信层。

统一原则：

- 浏览器不能决定自己是谁。
- 前端请求体里的 `userId` 不可信。
- URL 路径中的 `{user_id}` 不可信。
- 业务数据读写必须使用 session 解析出的当前用户 ID。
- 未登录游客只允许调用一次前端限制下的人设首轮生成链路，且后端不持久化。
- 热门追踪、内容撰写、人设保存、人设追问都必须登录。
- Agent 不负责用户隔离，Agent 只消费后端传入的上下文。

## Auth API

当前后端 auth 路由前缀为：

```text
/api/auth
```

正式接口：

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

### `POST /api/auth/register`

职责：

- 创建用户。
- 哈希保存密码。
- 创建 session。
- 写入 session cookie。
- 返回公开用户信息。

规则：

- 注册成功后创建 session 并写入 cookie，但前端交互层可以继续采用“提示用户去登录页完成后续进入”的产品流程。
- 用户名必须归一化。
- 密码不能明文保存。
- 返回体不能包含 `password_hash`、salt、session collection 内部字段。

### `POST /api/auth/login`

职责：

- 校验用户名和密码。
- 创建新的 session。
- 写入 session cookie。
- 返回公开用户信息。

规则：

- 登录失败返回 401。
- 错误文案不应区分“用户名不存在”和“密码错误”。
- 登录成功后只能通过 HttpOnly cookie 维持 session，不把 session id 放进 JSON 给前端读取。

### `POST /api/auth/logout`

职责：

- 删除当前 session。
- 清理 session cookie。

规则：

- 即使 session 已失效，也应返回可处理的成功响应。
- 退出后前端应立即进入匿名态。

### `GET /api/auth/me`

职责：

- 根据 cookie session 返回当前用户。

规则：

- 未登录返回 401。
- 已登录返回公开用户信息。
- 前端启动时通过该接口确认登录态。

## Session Cookie 规则

当前 session cookie 默认名：

```text
koc_session
```

规则：

- 必须设置 `HttpOnly`。
- 默认 `SameSite=Lax`。
- cookie path 为 `/`。
- 过期时间由 `SESSION_TTL_DAYS` 控制。
- 生产 HTTPS 环境应启用 `Secure`。

安全口径：

- 前端 JavaScript 不能读取 `koc_session`。
- 用户拿不到后端模型 API key，也拿不到 session 明文内部字段。
- 业务请求通过 `credentials: include` 自动携带 cookie。
- CORS 只允许受控来源并启用凭据，不允许随意开放 `* + credentials`。

## Auth 数据存储

当前 auth 默认数据库：

```text
koc_agent_auth
```

主要集合：

| 集合 | 用途 | 关键字段 |
| --- | --- | --- |
| `users` | 保存用户账号 | `user_id`、`username`、`password_hash` |
| `sessions` | 保存登录 session | `session_id`、`user_id`、`username`、`expires_at` |

索引要求：

- `users.username` 唯一。
- `sessions.session_id` 唯一。
- `sessions.expires_at` 使用 TTL 索引。

规则：

- `user_id` 使用不可预测 ID。
- `password_hash` 使用带 salt 的单向哈希。
- session 过期后不应继续解析为有效用户。

## 当前用户解析规则

后端统一提供两类依赖：

```text
get_current_user
require_current_user
```

语义：

- `get_current_user`：允许返回 `None`，用于游客可访问接口。
- `require_current_user`：未登录直接返回 401，用于受保护业务接口。

统一 401 响应：

```json
{
  "code": 401,
  "message": "未登录"
}
```

规则：

- 受保护接口不要在业务函数里手写重复登录判断。
- 应优先通过依赖注入统一处理。
- 401 响应结构应保持稳定，方便前端门禁统一识别。

## 接口保护矩阵

| 模块 | 接口 | 未登录 | 已登录 |
| --- | --- | --- | --- |
| Auth | `POST /api/auth/register` | 允许 | 允许 |
| Auth | `POST /api/auth/login` | 允许 | 允许 |
| Auth | `POST /api/auth/logout` | 允许 | 允许 |
| Auth | `GET /api/auth/me` | 401 | 返回当前用户 |
| 人设 | `POST /api/persona/analyze` | 允许但不持久化 | 允许并可持久化 |
| 人设 | `POST /api/persona/follow_up` | 401 | 允许 |
| 人设 | `POST /api/persona/save` | 401 | 允许 |
| 人设 | `GET /api/persona/me` | 401 | 返回当前用户人设 |
| 人设 | `GET /api/persona/{user_id}` | 401 | 忽略 path user_id，返回当前用户人设 |
| 热门 | `POST /api/trends/track` | 401 | 允许 |
| 热门 | `POST /api/trends/save` | 401 | 允许 |
| 热门 | `GET /api/trends/history` | 401 | 返回当前用户历史 |
| 热门 | `GET /api/trends/{user_id}/history` | 401 | 忽略 path user_id，返回当前用户历史 |
| 热门 | `GET /api/trends/latest` | 401 | 返回当前用户最新记录 |
| 热门 | `DELETE /api/trends/record` | 401 | 只删除当前用户记录 |
| 内容 | `POST /api/content/draft` | 401 | 允许 |
| 内容 | `POST /api/content/save` | 401 | 允许 |
| 内容 | `GET /api/content/history` | 401 | 返回当前用户草稿 |
| 内容 | `GET /api/content/{user_id}/history` | 401 | 忽略 path user_id，返回当前用户草稿 |
| 内容 | `DELETE /api/content/record` | 401 | 只删除当前用户草稿 |

## `userId` 处理规则

现阶段部分请求 schema 仍保留：

```json
{
  "userId": "demo-user"
}
```

这是历史兼容字段，不再是身份来源。

规则：

- 受保护接口必须忽略请求体中的 `userId`。
- 带 `{user_id}` 的历史路径必须忽略路径参数。
- 后端真正使用的用户 ID 只能来自 `current_user.user_id`。
- 测试必须覆盖“请求体伪造 userId 不生效”和“路径伪造 user_id 不生效”。

推荐过渡策略：

1. 第一阶段保留旧字段，后端忽略。
2. 第二阶段前端停止发送 `userId`。
3. 第三阶段后端 schema 移除 `userId`。
4. 删除前必须确认旧测试、脚本和文档已经同步更新。

## 游客人设生成规则

唯一允许游客访问的业务生成接口是：

```text
POST /api/persona/analyze
```

游客调用时：

- 后端可以使用固定内部 ID，例如 `guest-user`。
- 必须关闭持久化。
- 不允许写入 `persona_results`。
- 不允许写入 `personas`。
- 不允许生成可在后续业务模块复用的正式保存人设。

已登录调用时：

- 使用 `current_user.user_id`。
- 可以按当前人设保存策略持久化。
- 后续热门追踪、内容撰写读取的也是该用户的人设。

说明：

- 游客“一次”限制当前主要由前端通过 localStorage 控制。
- 后端当前不以游客次数控制为主责。
- 如果未来对外开放高风险流量，应补充后端匿名限流。

## 业务数据隔离规则

所有业务数据集合必须以 `user_id` 作为隔离条件。

当前业务集合：

| 数据类型 | 数据库 | 集合 | 隔离条件 |
| --- | --- | --- | --- |
| 人设自动保存 / 默认读取 | `koc_agent_persona` | `persona_results` | `user_id = current_user.user_id` |
| 人设手动保存 | `koc_agent_persona` | `personas` | `user_id = current_user.user_id` |
| 趋势记录 | `koc_agent_trend` | `trend_snapshots` | `user_id = current_user.user_id` |
| 内容草稿 | `koc_agent_content` | `content_drafts` | `user_id = current_user.user_id` |

规则：

- 查询历史时必须带当前用户 `user_id`。
- 保存时必须写当前用户 `user_id`。
- 更新时必须同时匹配业务记录 ID 和当前用户 `user_id`。
- 删除时必须同时匹配业务记录 ID 或 fallback 业务键和当前用户 `user_id`。
- 不允许仅按 draft id、trend id 或 path user_id 操作数据。

## 后端到 Agent 的用户隔离

Agent 不连接业务数据库，也不负责鉴权。

后端调用 Agent 时：

```json
{
  "userId": "current_user.user_id",
  "context": {}
}
```

规则：

- `userId` 必须来自 session 用户。
- context builder 读取的人设、趋势历史、草稿历史必须按当前用户查询。
- Agent 返回的 `savePayload` 不能覆盖后端的 `user_id` 决策。
- 后端保存 Agent 结果时仍使用当前 session 用户 ID。

也就是说：

```text
session user_id
→ 后端查询该用户上下文
→ 后端调用 Agent
→ 后端按同一 user_id 保存结果
```

不能出现：

```text
请求体 userId
→ 后端查询其他用户上下文
→ Agent 生成
→ 写入其他用户数据
```

## 并发边界

当前多账号部署至少要保证用户隔离，不强制在本文档中完成全量并发队列。

当前业务规则：

- 单个用户同时最多 1 个内容生成。
- 单个用户同时最多 1 个趋势追踪。
- 登录接口每分钟 1 次。
- 内容生成每分钟 5 次。
- 热点追踪每分钟 5 次。

第一版建议：

- 前端先通过生成态按钮防止同页重复提交。
- 后端后续应补 per-user in-flight guard 和 rate limit。
- 限流 key 应优先使用 `current_user.user_id`，未登录则使用 IP 或匿名指纹。

注意：

- 并发控制不能只靠前端。
- 多浏览器、多设备或脚本请求都可以绕过前端状态。
- 如果进入真实生产开放环境，应把后端并发与限流作为必须补项。

## Debug Route 与 Prompt 调试

生产环境必须禁用内部生成调试能力。

需要禁用或不暴露：

- 后端 `/api/debug/*`
- Agent `/debug`
- Agent `/debug/*`
- Prompt Lab 页面
- 前端 Prompt 调试页面

规则：

- 生产环境不展示 prompt 调试入口。
- 生产环境不允许用户传入 `promptOverride`。
- 生产环境不允许用户传入 debug API key。
- 内部调试 route 如果保留，必须有环境开关和访问控制。

这条规则的目的不是隐藏前端页面，而是防止用户通过调试接口影响 prompt、工具调用或模型配置。

## 测试要求

后端 auth/user isolation 至少覆盖：

1. 未登录调用受保护业务接口返回标准 401。
2. 未登录调用 `persona.analyze` 可以成功，但使用游客 ID 且不持久化。
3. 已登录调用业务接口时忽略请求体 `userId`。
4. 已登录访问 `/{user_id}/history` 这类旧路径时忽略 path user_id。
5. 用户 A 保存的数据，用户 B 不能读取、更新或删除。
6. 登出后 `/api/auth/me` 返回 401。
7. session 过期后不能继续访问受保护接口。

## 对后端实现者的硬规则

1. 所有正式业务数据读写都必须从 session 用户取 `user_id`。
2. 不允许信任请求体 `userId`。
3. 不允许信任路径 `{user_id}`。
4. 游客只能进 `persona.analyze`，且不持久化。
5. 热门追踪、内容撰写、人设保存、人设追问必须登录。
6. 统一 401 响应结构必须保持稳定。
7. Agent 不承担鉴权，后端必须在调用 Agent 前完成身份和上下文隔离。
8. 生产环境必须关闭 debug route 和 prompt 调试入口。

## 当前文档落地结论

后端 auth/user isolation 的核心结论是：

```text
cookie session 是唯一身份来源；业务 user_id 只来自 session；旧 userId 字段只兼容不可信；游客只做人设首轮且不落库。
```

