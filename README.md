# KOC Agent

KOC Agent 是一个面向小红书图文创作的全栈 Agent demo。项目目标不是做一组分散页面工具，而是把“人设打造、热门追踪、内容撰写”串成一个统一的对话式创作工作台：用户先说需求，系统判断当前阶段，调用对应 Agent 能力，保存对话和模块记忆，并把当前进度整理给前端展示。

当前主线对应 0.0.8 版本 PRD：

- P0：统一对话入口与流程引导。
- P0：对话记忆和模块记忆分层，防止不同人设、选题、内容草稿串记忆。
- P1：摘要框数据、历史对话、消息回溯和内容多草稿存档。
- P2：Human Voice Skill，让输出更像真人创作顾问，减少 AI 模板味。

## 当前能力

### 统一对话 Agent

统一入口：

```text
POST /api/agent/chat
```

核心流程：

```text
用户输入
  -> 后端判断当前步骤
  -> 调用 persona / trend / content 服务
  -> Agent 服务执行对应 workflow
  -> 后端保存对话消息和模块记忆
  -> 返回 assistant_message、current_step、summary、memory_refs
```

默认主链路：

1. `persona`：根据用户描述生成人设方向。
2. `trending`：基于当前人设追踪热门方向和选题。
3. `content`：基于当前人设和选题生成小红书图文草稿。

`image_guidance` 目前只保留枚举，暂未接入正式统一对话流程。

### 分层记忆

后端在 `memory_db` 下保存统一对话相关数据：

- `agent_chat_conversations`：会话状态、当前步骤、当前激活的人设/选题/内容记忆。
- `agent_chat_messages`：对话框消息流，用于上下文延续和摘要点击回溯。
- `agent_module_memories`：模块结构化记忆，包含人设、热门追踪和内容草稿。

记忆边界：

- 对话记忆只记录当前聊天上下文。
- 模块记忆保存阶段产物。
- 内容草稿必须绑定对应 `persona_memory_id` 和 `trending_memory_id`。
- 新建新人设会创建新对话，历史对话和历史记忆保留。
- 历史对话标题使用人设简要描述。

### 内容多草稿存档

内容撰写不会直接覆盖旧稿。

当用户说“再写一篇新的 / 换个内容 / 另一个角度 / 重新写一篇”时：

- 后端新增一条 `module="content"` 记忆。
- 旧内容继续保留。
- 当前激活草稿由 `active_content_memory_id` 指向。
- 前端可通过 `summary.content.items` 展示“内容撰写”下面的多个小点。

### Human Voice Skill

P2 新增本地表达 skill：

```text
prompts/skills/human-voice.skill.md
```

skill 自动注入这些 Agent 任务：

- `persona.analyze`
- `persona.follow_up`
- `trend.track`
- `topic.recommend`
- `content.draft`
- `content.revise`

不默认注入 `general.chat`，避免影响普通通用聊天。

目标：

- 人设输出像内容陪练，不像 IP 咨询报告。
- 热门追踪像把热点翻译成可写选题，不像市场研究报告。
- 内容草稿像真实小红书笔记，不像 AI 模板。
- 减少“首先、其次、最后、综上”等报告连接词。
- 减少“用户痛点、内容矩阵、赛道、情绪价值”等运营腔。

调试接口 `/api/debug/prompts` 会返回 prompt 内容、`appliedSkills` 和 skill 内容，方便确认当前规则是否生效。

## 项目结构

```text
KOC-program
├─ frontend/       前端界面，负责页面、消息流、摘要框视觉和交互
├─ backend/        业务后端，负责登录、接口、业务服务、数据保存、统一对话编排
├─ agent/          独立 Agent 服务，负责 task router、workflow、prompt 加载、模型运行时和工具调用
├─ prompts/        Agent prompt 模板和 skill 规则
├─ docs/           项目文档、harness 文档和协作说明
├─ deploy/         Nginx 等部署配置
├─ examples/       Agent 请求样例
├─ tools/          辅助脚本
└─ docker-compose.full.yml
```

## 架构分工

### Frontend

负责：

- 对话式页面。
- 输入框和消息流。
- 左侧导航、右侧摘要框。
- 完成状态、绿色对号、摘要点击滚动。
- 响应式布局。

前端通过后端接口拿数据，不直接判断模型、不保存模块记忆、不硬编码模型 ID 或 API Key。

### Backend

负责：

- Web API。
- 登录态和游客态用户隔离。
- 统一对话 Agent 编排。
- 对话记忆和模块记忆持久化。
- 人设、热门、内容服务的业务封装。
- 对 Agent 服务发起 `POST /agent/run` 调用。
- 把 Agent 结果整理成前端统一需要的响应结构。

### Agent

负责：

- `/agent/run` 统一 Agent 执行入口。
- task router。
- persona / trend / content / general chat workflow。
- prompt 和 skill 加载。
- 模型 runtime 选择。
- web_search 工具决策和结果注入。
- 返回统一 `AgentRunResponse`。

Agent 不直接写业务数据库，业务保存由 Backend 负责。

## 主要接口

### 统一对话

```text
POST /api/agent/chat
GET  /api/agent/conversations
GET  /api/agent/conversations/{conversation_id}
```

`POST /api/agent/chat` 返回核心字段：

```json
{
  "conversation_id": "conv_xxx",
  "conversation_title": "平价美妆真实测评",
  "assistant_message": {
    "id": "msg_xxx",
    "role": "assistant",
    "content": "我们先把人设定下来...",
    "created_at": "2026-07-21T10:30:00+08:00"
  },
  "current_step": "persona",
  "next_step": "trending",
  "summary": {
    "persona": {
      "done": true,
      "title": "人设打造",
      "text": "平价美妆真实测评型博主...",
      "message_id": "msg_xxx",
      "memory_id": "persona_xxx"
    },
    "trending": {
      "done": false,
      "title": "热门追踪",
      "text": "",
      "message_id": null,
      "memory_id": null
    },
    "content": {
      "done": false,
      "title": "内容撰写",
      "text": "",
      "message_id": null,
      "memory_id": null,
      "items": []
    }
  },
  "memory_refs": {
    "conversation_memory_id": "conv_mem_xxx",
    "persona_memory_id": "persona_xxx",
    "trending_memory_id": null,
    "content_memory_id": null
  }
}
```

### 旧模块接口

旧模块接口继续保留，统一对话入口只是新增主入口，不删除独立模块能力。

```text
POST /api/persona/analyze
POST /api/persona/follow_up
POST /api/persona/save
GET  /api/persona/history

POST /api/trends/track
POST /api/trends/save
GET  /api/trends/history
GET  /api/trends/latest

POST /api/content/draft
POST /api/content/save
GET  /api/content/history
```

### Agent 服务接口

```text
GET  /health
GET  /agent/tasks
GET  /agent/tools
POST /agent/run
```

当前支持的 Agent task：

```text
general.chat
memory.summarize_conversation
persona.analyze
persona.follow_up
trend.track
topic.recommend
content.draft
content.revise
```

### 调试接口

```text
GET /api/debug/prompts
```

返回 persona / trending / content 的 prompt、已应用 skill，以及 `human_voice` skill 内容。

## Prompt 与 Skill

Prompt 文件：

```text
prompts/general-chat.prompt.md
prompts/persona.prompt.md
prompts/trend-tracking.prompt.md
prompts/xhs-content-writing.prompt.md
```

Skill 文件：

```text
prompts/skills/human-voice.skill.md
```

Agent 服务通过 `agent/app/prompts/loader.py` 读取 prompt 和 skill。`BaseWorkflow` 会在模型调用前把 task 对应的 skill 追加到 prompt 后面。

## 启动方式

默认从仓库根目录启动整套服务：

```powershell
docker compose -f docker-compose.full.yml up --build -d
```

访问地址：

- 前端：`http://127.0.0.1:5000`
- 后端健康检查：`http://127.0.0.1:5001/api/health`
- Nginx 聚合入口：`http://127.0.0.1:8928`

默认不建议单独散跑 frontend / backend / agent。只有在明确调试某个模块时，才进入对应目录单独启动。

## 配置

本地配置放在 `.env`，不要提交真实密钥。

常用变量：

```text
AGENT_RUNTIME_MODE=model
AGENT_RUNTIME_PROVIDER=model
AGENT_BASE_URL=http://agent:8010
AGENT_ENABLE_TOOLS=true
AGENT_DEBUG_TRACE=false

MODEL_API_KEY=
MODEL_BASE_URL=https://api.openai-proxy.org/google/v1beta
MODEL_NAME=gemini-2.5-flash

GOOGLE_API_KEY=
GEMINI_API_KEY=

WEB_SEARCH_PROVIDER=
WEB_SEARCH_API_KEY=
WEB_SEARCH_TIMEOUT_MS=8000
```

模型名必须使用供应商控制台可调用的真实模型 ID 或接入点 ID，不要使用展示名。不要在前端硬编码模型 ID、API Key 或搜索 provider。

## 测试

### 后端测试

```powershell
docker compose -f docker-compose.full.yml exec -T backend sh -lc "pytest"
```

### Agent 测试

```powershell
docker compose -f docker-compose.full.yml exec -T agent sh -lc "pytest"
```

说明：

- 后端测试覆盖 Web API、用户隔离、persona / trend / content 服务、统一对话和 debug prompt。
- Agent 测试覆盖 task router、workflow、runtime 选择、prompt/skill 注入和 web_search contract。
- 当前若全量 Agent 测试出现 `mock_retrieval` source 相关失败，需要先确认该旧测试是否已同步到新的 retrieval source schema。

## 文档入口

项目文档：

```text
docs/README.md
docs/harness/README.md
```

建议阅读顺序：

1. `docs/harness/01-foundation/harness-overview.md`
2. `docs/harness/01-foundation/agent-architecture.md`
3. `docs/harness/02-orchestration/contracts/agent-api-contract.md`
4. `docs/harness/02-orchestration/contracts/frontend-backend-agent-handoff.md`
5. `docs/harness/02-orchestration/scenarios/persona-workflow.md`
6. `docs/harness/02-orchestration/scenarios/trend-tracking-workflow.md`
7. `docs/harness/02-orchestration/scenarios/content-writing-workflow.md`

## 协作边界

推荐分工：

- 前端同学主要动 `frontend/`。
- 后端同学主要动 `backend/`、`agent/`、`prompts/`、API schema 和 README。
- 公共接口先通过小 PR 约定，再分别开发。
- 不要两个人同时改同一个大文件。
- 每个 PR 尽量小，先跑测试再提交。

本项目当前统一对话接口已经给前端提供：

- 消息内容。
- 当前步骤。
- 每一步摘要。
- 每一步完成状态。
- 对应消息 ID。
- 当前激活记忆 ID。
- 内容草稿多版本 items。

## 当前不处理

- 不做自动发布到小红书。
- 不接入小红书官方私有数据。
- 不承诺真实官方热度榜。
- 不做复杂画布、拖拽拼图或完整图片编辑器。
- 不删除旧模块页面，只新增统一对话主入口和后端编排能力。
- 不把所有历史记忆混成一个大上下文。
- 不展示内部完整推理链路，只展示用户可理解的阶段、结果和来源。
