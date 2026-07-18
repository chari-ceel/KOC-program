# 数据存储现状

本文记录当前代码中的真实数据存储方式，范围包括：

- 前端全局状态与本地缓存
- 后端 MongoDB 落库
- Agent mock / examples / prompts
- 页面刷新后的恢复能力

本文基于当前实现核对：

- 前端：`frontend/context/AppStateContext.tsx`、`frontend/app/profile/page.tsx`、`frontend/app/trending/page.tsx`、`frontend/app/content/page.tsx`、`frontend/components/ChatDialog.tsx`
- 后端：`backend/app/database/database.py`、`backend/app/database/crud/*.py`、`backend/app/endpoints/web/*.py`、`backend/app/services/*.py`、`backend/app/adapters/agent/*.py`
- Agent：`agent/README.md`、`agent/app/responses/mock_response_loader.py`、`examples/agent-responses/`、`examples/tool-results/`、`prompts/`

## 当前 Harness 口径

当前正式页面与业务语义范围需要先区分两层：

1. 三条正式业务主线
2. 正式聊天页面体系

其中：

- 三条正式业务主线当前指：人设打造、热门追踪、内容撰写
- 正式聊天页面体系当前指：人设打造、热门追踪、内容撰写、灵光一闪 `/?view=dialog`
- `/data`、`/operation` 当前不纳入本文主线分析范围

在 harness 视角下，当前存储层需要区分三类东西：

1. 已保存业务结果
2. session 级对话现场
3. 当前实现里的兼容性本地缓存

统一理解：

- `personaDraft`、`completeAnalysis`、`completeDraft` 属于业务结果语义
- 页面里的 chat state、scrollTop、viewMode、activeDraftId 等，属于 session 级会话现场
- 某些 `localStorage` / `sessionStorage` 键当前只是为了页面恢复和兼容，不应直接等同于正式业务结果
- `general.chat` / 灵光一闪当前只属于正式聊天页面体系，不属于三条结构化业务主线

这一区分很重要，因为 harness 主线要求：

- 前端本地存储主要承担“会话恢复”职责
- 正式业务结果由后端结构化返回并在需要时落库
- 前端不应把临时对话缓存误当成正式已完成结果
- 灵光一闪当前的本地会话状态也只应按“会话恢复”理解，不应被误写成新的业务结果存储类型

## 1. 数据库与集合

后端当前使用 PyMongo 直连 MongoDB。

### 环境变量

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MONGO_URI` | `mongodb://localhost:27017` | Mongo 连接地址 |
| `PERSONA_DB_NAME` | `koc_agent_persona` | 人设数据库 |
| `TREND_DB_NAME` | `koc_agent_trend` | 趋势数据库 |
| `CONTENT_DB_NAME` | `koc_agent_content` | 内容数据库 |
| `AUTH_DB_NAME` | `koc_agent_auth` | 登录用户与 session 数据库 |
| `ANALYTICS_DB_NAME` | `koc_agent_analytics` | 行为埋点数据库，规划中 |

### 当前连接方式

当前在模块导入时就创建：

- `client = MongoClient(...)`
- `persona_db`
- `trend_db`
- `content_db`

没有显式连接池健康检查、关闭钩子或索引初始化逻辑。

### 当前主要集合

| 数据类型 | Mongo database | Mongo collection | 当前写入方式 |
| --- | --- | --- | --- |
| 人设自动保存 / 默认读取 | `koc_agent_persona` | `persona_results` | `replace_one({"user_id": user_id}, {"user_id": user_id, "data": payload}, upsert=True)` |
| 人设手动保存 | `koc_agent_persona` | `personas` | `replace_one(..., upsert=True)` |
| 趋势记录 | `koc_agent_trend` | `trend_snapshots` | `update_one(..., upsert=True)` 或按 fallback 条件 upsert |
| 内容草稿 | `koc_agent_content` | `content_drafts` | 有 `id` 时 `update_one(..., upsert=True)`，无 `id` 时 `insert_one()` |
| 用户账号 | `koc_agent_auth` | `users` | `insert_one()`，`username` 唯一 |
| 登录 session | `koc_agent_auth` | `sessions` | `insert_one()`，`expires_at` TTL 过期 |
| 行为埋点 | `koc_agent_analytics` | `analytics_events` | 规划中：通过 `POST /api/analytics/events` 追加写入 |

### 行为埋点规划

当前代码尚未实现独立 analytics 路由。后续若落地 Agent 输出复制和对话轮次监控，应新增独立埋点库，不应写入人设、趋势、内容业务集合。

规划入口：

```text
POST /api/analytics/events
```

规划集合：

```text
koc_agent_analytics.analytics_events
```

第一版事件：

| event_name | 用途 |
| --- | --- |
| `agent_output_copy` | 统计官方复制按钮点击、复制频率、复制板块 |
| `conversation_turn_started` | 统计一轮对话开始 |
| `conversation_turn_completed` | 统计一轮对话成功完成 |
| `conversation_turn_failed` | 统计一轮对话失败、超时或停止 |

隐私边界：

- 不落用户输入正文。
- 不落 Agent 输出正文。
- 后端从 session cookie 解析 `user_id`。
- 前端只传模块、会话 ID、消息 ID、长度、状态、耗时等行为元数据。

详细规划见：

- [agent-output-copy-and-analytics.md](../frontend/agent-output-copy-and-analytics.md)

## 2. 当前用户标识

当前多账号部署口径下，业务用户标识来自后端 session。

```text
koc_session cookie -> /api/auth/me -> current_user.user_id
```

当前规则：

- 前端不再把 `demo-user` 当作真实业务用户。
- 请求体里的 `userId` 只作为历史兼容字段保留，不再作为身份来源。
- 路径里的 `{user_id}` 只作为历史兼容路径保留，后端读取时应忽略并使用当前 session 用户。
- 游客只允许进入 `persona.analyze`，且不持久化。

详细身份隔离规则见：

- [auth-user-isolation.md](./auth-user-isolation.md)

## 3. 人设数据

### 前端保存位置

当前人设前端有三层来源：

1. React Context：`AppStateContext.state.persona`
2. 浏览器 `localStorage`：key 为 `koc-agent-persona-json`
3. 后端 Mongo：登录后通过 `GET /api/persona/me` 恢复当前 session 用户的人设

### 前端恢复逻辑

当前 `AppStateProvider` 启动时会：

1. 等待 auth 状态确认。
2. 已登录时请求 `GET /api/persona/me`
2. 如果后端返回合法 persona，则优先用远端数据
3. 如果远端没有，再读 `localStorage`
4. 未登录时清理当前全局用户数据

也就是说当前优先级是：

```text
已登录：后端 Mongo > localStorage
未登录：不拉取远端用户数据
```

### 人设页面自己的额外缓存

[profile/page.tsx](../../../../frontend/app/profile/page.tsx) 还使用了：

- `sessionStorage`
  - `koc-agent-profile-chat-state`
  - `koc-agent-profile-chat-scroll-top`
- `localStorage`
  - `koc-agent-profile-view-mode`

这些主要用于：

- 恢复人设聊天页当前视图
- 恢复草稿消息
- 恢复滚动位置

### 后端保存位置

#### 手动保存

`POST /api/persona/save`：

- `PersonaService.save_persona()`
- `PersonaCRUD.save_persona(..., collection_name="personas")`

写入：

```text
koc_agent_persona.personas
```

#### Agent 自动保存

`POST /api/persona/analyze`：

- Agent 返回 `savePayload`
- `PersonaService._persist_persona_save_payload()` 会自动落库

默认写入：

```text
koc_agent_persona.persona_results
```

### 当前读取逻辑

`PersonaCRUD.get_persona()` 当前按以下顺序读取：

1. `persona_results`
2. `personas`

所以如果两个集合都有数据：

- `persona_results` 优先
- 手动保存到 `personas` 的数据不一定会成为刷新后的最终恢复结果

### 刷新后当前能恢复什么

可以恢复：

- 已保存人设
- 人设聊天页当前 session 中的消息草稿和滚动状态
- 远端失效时本地 `localStorage` 中的人设

不能完整恢复：

- 没保存到最终人设结构、但只是临时聊出来的细碎中间过程，跨设备不会同步
- `persona.follow_up` 的每轮 `savePayload` 当前没有统一后端持久化

## 4. 趋势记录

### 前端保存位置

当前趋势页有三层来源：

1. React Context：`AppStateContext.state.trendRecords`
2. 后端 Mongo：登录后通过 `GET /api/trends/history` 读取当前 session 用户历史
3. 页面内默认样例：`defaultHistoryRecords`

`AppStateProvider` 启动时已经会主动拉：

```text
GET /api/trends/history
```

所以“刷新后趋势历史完全丢失”已经不符合现状。

### 趋势页自己的额外缓存

[trending/page.tsx](../../../../frontend/app/trending/page.tsx) 还使用：

- `sessionStorage`
  - `koc-agent-trending-chat-state`
  - `koc-agent-trending-chat-scroll-top`
  - `koc-agent-trending-view-mode`
- `localStorage`
  - `koc-agent-trending-hidden-defaults`

这些主要用于：

- 恢复趋势聊天页会话
- 恢复滚动位置
- 记住哪些默认样例被隐藏

### 后端保存位置

`POST /api/trends/save`：

- `TrendService.save_trend_record()`
- `TrendCRUD.save_trend_snapshot()`

写入：

```text
koc_agent_trend.trend_snapshots
```

当前正式口径补充：

- 趋势记录不只保存摘要字段。
- 每条已保存热门追踪记录应同时保存：
  - `trackName`
  - `trends`
  - `audience`
  - `topics`
  - `cardPreview`
  - 当前记录对应的完整可见 `conversationHistory`
- 用户从热门追踪历史卡片重新进入时，前端应优先恢复这份已保存的完整会话。

### 趋势卡片预览字段

新生成的完整热门追踪结果应随业务数据一起保存：

```json
{
  "cardPreview": {
    "discoveryKeywords": ["平价替代", "新手化妆", "通勤妆"],
    "shortTopics": ["新手通勤妆", "百元彩妆清单", "底妆避坑"]
  }
}
```

存储口径：

- `cardPreview` 是 `completeAnalysis` / 趋势记录数据的一部分。
- 该字段由 Agent 在完整分析同次输出。
- 后端负责归一化、保存和恢复。
- 前端历史卡片优先消费该字段。
- 旧记录缺少该字段时，前端可以短语级兜底，但不应展示长段摘要。

### 趋势记录的更新 / 删除规则

当前 `TrendCRUD.save_trend_snapshot()` 的逻辑是：

- 如果 `payload.id` 存在，则优先按 `user_id + data.id` 更新
- 同时若能构造 fallback query，也会兼容旧业务键
- 如果没有 `id`，则要求至少能用：
  - `trackName`
  - `trackTime`
  - `userPrompt`

作为 fallback 唯一键

删除逻辑也是类似：

- 优先按 `data.id`
- 否则退回 `trackName + trackTime + userPrompt`

### 当前恢复能力

可以恢复：

- 已保存到 Mongo 的趋势记录
- 当前登录用户的趋势记录
- 默认样例记录
- 当前趋势聊天页 session 会话与滚动位置

不能完整恢复：

- 未写入 Mongo 且浏览器 session 已结束的趋势对话
- Agent 真正使用的 `trendHistory` 上下文，因为 builder 目前仍传空数组

## 5. 内容草稿

### 前端保存位置

当前内容页的数据来源有三层：

1. React Context：`AppStateContext.state.drafts`
2. 后端 Mongo：登录后通过 `GET /api/content/history` 读取当前 session 用户草稿
3. 页面内默认样例：`defaultDrafts`

`AppStateProvider` 启动时已经会主动拉：

```text
GET /api/content/history
```

所以旧文档里“前端不加载内容历史”这条已经过时。

### 内容页自己的额外缓存

[content/page.tsx](../../../../frontend/app/content/page.tsx) 当前还使用：

- `sessionStorage`
  - `koc-agent-active-draft-id`
  - `koc-agent-content-view-mode`
  - `koc-agent-content-chat-state`
  - `koc-agent-content-chat-scroll-top`
- `localStorage`
  - `koc-agent-hidden-default-draft-ids`

这些主要用于：

- 恢复当前打开的草稿
- 恢复聊天式改稿会话
- 恢复滚动位置
- 隐藏默认样例草稿

当前新增口径：

- 页面联动进入内容页时，只传当前入口相关的 `writingEntrySource`
- 不通过页面跳转传递 `draftHistory`、`trendHistory`、`conversationHistory`
- 这几类历史接口继续保留，但当前不作为多页面联动依赖

### 后端保存位置

`POST /api/content/save`：

- `ContentService.save_draft_record()`
- `ContentCRUD.save_draft()`

写入：

```text
koc_agent_content.content_drafts
```

### 草稿卡片预览字段

新生成的完整内容草稿应随业务数据一起保存：

```json
{
  "cardPreview": {
    "keywords": ["考证避坑", "自律补救", "低成本学习"]
  }
}
```

存储口径：

- `cardPreview` 是 `completeDraft` / 内容草稿数据的一部分。
- 该字段由 Agent 在完整草稿同次输出。
- 后端负责归一化、保存和恢复。
- 新草稿保存时，记录级 `title` 应与 `structured.noteTitle` 对齐，作为草稿箱卡片标题来源。
- 前端草稿卡片优先消费该字段。
- 旧草稿缺少该字段时，前端可以从 `title`、`tags` 或既有短字段做短语级兜底，但不应展示长段正文摘要。
- 新草稿保存时还应保留 `draftSource`，用于区分热门追踪入口、赛道入口或用户主动输入入口。

### 草稿更新规则

当前 `ContentCRUD.save_draft()`：

- 有 `payload.id` 时，按 `user_id + data.id` upsert
- 没有 `id` 时，直接 `insert_one`

### 当前恢复能力

可以恢复：

- 已保存到 Mongo 的草稿历史
- 当前登录用户的内容草稿
- 默认样例草稿
- 当前内容聊天页 session 状态
- 当前激活草稿与滚动位置

不能完整恢复：

- 未写入 Mongo、且 session 已结束的临时草稿会话
- 跨设备共享的内容优化中间状态

## 6. 临时聊天

临时聊天来自 [ChatDialog.tsx](../../../../frontend/components/ChatDialog.tsx)，接口为：

```text
POST /api/chat
```

### 前端保存位置

当前只保存在组件 state：

- `messages`
- `inputValue`

没有 `localStorage`，也没有 `sessionStorage`。

### 后端行为

后端会：

- 组装 `general.chat` 请求
- 带上前端传来的 `conversationHistory`
- 调 Agent

当前不会把聊天历史写入 Mongo。

### 刷新后能恢复什么

不能恢复：

- 页面刷新后全部丢失
- 组件卸载后全部丢失

需要特别指出：

- UI 上“关闭后保留”这句话，只在当前组件未卸载的页面生命周期内成立
- 不代表刷新后还会保留

## 7. Agent、examples、prompts

### Agent 的数据边界

`agent/README.md` 与当前代码都明确表明：

- Agent 不接前端业务
- Agent 不连业务数据库
- Agent 不直接保存业务数据

### `examples/`

当前根目录 `examples/` 是协议样例与 mock 资源，不是业务数据存储。

包括：

- `examples/agent-requests/*.json`
- `examples/agent-responses/*.json`
- `examples/tool-results/*.json`

### 后端 mock Agent 来源

当：

```text
AGENT_USE_MOCK=true
```

后端 `AgentClient` 会直接读取：

```text
examples/agent-responses/{taskType}.success.json
```

### Agent 自身 mock 来源

Agent 内部 mock runtime / mock loader 也会读取：

```text
examples/agent-responses/
```

### `backend/mocks/`

`backend/mocks/agent_responses/` 当前不是主链路默认来源，除非未来显式传 `mock_dir`。

### `prompts/`

根目录 `prompts/` 中的文件：

- `persona.prompt.md`
- `trend-tracking.prompt.md`
- `xhs-content-writing.prompt.md`
- `general-chat.prompt.md`

它们是静态 prompt 资源，不是用户业务数据。

## 8. `savePayload` 与真实落库差异

当前一个非常重要的现状是：

- Agent 的 `savePayload.suggestedCollection` 只是建议
- 不等于后端一定按这个集合名落库

### 当前真实情况

#### `persona.analyze`

- Agent `savePayload` 当前会被后端自动消费并落库
- 默认读取优先仍是 `persona_results`

#### `trend.track`

- Agent `savePayload` 当前不会自动落库
- 只有前端明确调用 `/api/trends/save` 才写入 `trend_snapshots`

#### `content.draft` / `content.revise`

- Agent `savePayload` 当前不会自动落库
- 只有前端明确调用 `/api/content/save` 才写入 `content_drafts`

#### `general.chat`

- `savePayload` 当前不会落库

## 9. 当前真实恢复能力总结

### 当前能恢复

- 已保存人设
- 已保存趋势历史
- 已保存内容草稿历史
- profile / trending / content 三个页面各自的 session 级聊天状态与滚动位置
- 默认样例趋势与默认样例草稿的显隐状态

### 当前不能稳定恢复

- 临时聊天弹窗内容
- 仅存在于浏览器 session、且 session 已结束的趋势 / 内容中间对话
- 真正进入 Agent 上下文的趋势历史
- 多端一致的人设追问过程明细

## 10. 当前风险

1. 人设读取优先级可能覆盖手动保存结果  
   `persona_results` 优先于 `personas`，可能导致手动保存后刷新又看到旧结果。

2. 趋势历史虽然持久化了，但并没有真正注入 Agent  
   `ContextBuilder._mock_get_trend_history()` 仍返回空数组。

3. `savePayload.suggestedCollection` 与真实落库集合不一致  
   文档、mock、后端 CRUD 命名并不总是对齐。

4. 临时聊天文案有误导性  
   UI 写“关闭后保留”，但刷新后并不会恢复。

5. Mongo 在模块导入时直接建立连接  
   当前没有连接健康检查、索引初始化或异常隔离策略。

6. 趋势和内容的“自动保存 / 手动保存”策略不一致
   人设是自动保存，趋势和内容是手动保存，容易让用户误解。

7. 业务主键策略仍不统一
   趋势有 `id` + fallback 组合键，内容依赖 `data.id`，人设依赖 `user_id` 覆盖。

8. 页面联动与历史接口边界容易混淆
   当前应坚持“只跨页面传入口来源和当前选题，不跨页面搬运整包历史记录”。

9. 生产环境 debug / prompt 调试入口如果未关闭，会破坏正式业务边界
   这类入口不应暴露给最终用户。

## 11. 当前建议

1. 统一人设主读取源  
   明确 `persona_results` 与 `personas` 的职责，避免刷新后优先读到旧数据。

2. 让趋势历史真正进入 Agent `context`  
   否则数据库里有历史，Agent 却感知不到。

3. 统一保存策略  
   明确哪些结果“生成即保存”，哪些“必须手动保存”。

4. 校正临时聊天文案  
   改成更贴近真实行为的说明。

5. 补充 Mongo 索引与健康检查  
   当前数据量一大就会暴露出管理问题。

6. 建立 `savePayload.type / suggestedCollection -> 后端集合` 的明确映射  
   不要把 Agent 建议集合名直接当作真实落库规则。

7. 对生产环境关闭 debug route 与 prompt 调试入口
   不让最终用户接触内部调试能力。

## 当前总结

- 当前前端的数据恢复能力其实比旧文档写的更强，尤其是趋势和内容历史已经会在全局状态初始化时主动拉取。
- 当前真正没完全解决的，不是“有没有存”，而是“存了之后是否被正确优先读取、是否真正再次喂回 Agent、是否在不同页面和不同设备下保持一致”。
- 这一轮登录态接入后，用户身份来源已经转向 session；下一步优先级应放在：统一读取优先级、趋势历史注入 Agent、保存策略统一、生产调试入口收口。
