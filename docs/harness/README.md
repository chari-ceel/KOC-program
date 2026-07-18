# Harness Docs 导览

## 说明

当前 `docs/harness/` 是 KOC 项目中与 harness 主线相关的正式文档目录。

默认运行约定：

- harness 联调、测评、复现问题时，默认从仓库根目录通过 `python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d` 启动整套环境
- 默认前端访问入口为 `http://127.0.0.1:5000`
- 如需统一入口，使用 `http://127.0.0.1:8928`
- 不再把本地 `localhost:3000` 或手动单独跑 `frontend` / `backend` / `agent` 作为默认联调方式

默认测试工具位置：

- 后端 `pytest`
  - 代码位置：`backend/tests/`
  - 依赖声明：`backend/requirements-test.txt`
  - Docker 容器：`backend`
  - 推荐执行：`python tools/docker_queue.py run --session-id <agent-session-id> --label "backend pytest" -- docker compose -f docker-compose.full.yml exec -T backend sh -lc "pytest"`
- Agent `pytest`
  - 代码位置：`agent/tests/`
  - 依赖声明：`agent/pyproject.toml`
  - Docker 容器：`agent`
  - 推荐执行：`python tools/docker_queue.py run --session-id <agent-session-id> --label "agent pytest" -- docker compose -f docker-compose.full.yml exec -T agent sh -lc "pytest"`
- 前端真实浏览器测试
  - 当前脚本：`frontend/scripts/ui-fulltest.mjs`
  - 运行依赖：`playwright` + `chromium`
  - 依赖声明：`frontend/package.json`
  - 说明：这里的 `chromium` 由 Playwright 调起，不是仓库里单独维护一套浏览器驱动脚本

这套目录不再把所有文档简单平铺，而是按“研发链路中的职责”分层：

1. 先定义这套 harness 是什么
2. 再定义它怎么跨层调度
3. 再定义它如何落实到实现
4. 最后定义它如何验收、排障与推进

## 目录结构

```text
docs/harness
├─ 01-foundation
├─ 02-orchestration
│  ├─ contracts
│  └─ scenarios
├─ 03-implementation
│  ├─ frontend
│  ├─ backend
│  └─ agent
├─ 04-validation
└─ README.md
```

## 1. Foundation

回答：

- harness 到底是什么
- 哪些抽象必须统一
- 哪些架构边界不能被页面或局部实现改掉

文档：

- [harness-overview.md](./01-foundation/harness-overview.md)
- [formal-chat-scenarios-harness-architecture.md](./01-foundation/formal-chat-scenarios-harness-architecture.md)
- [agent-architecture.md](./01-foundation/agent-architecture.md)

## 2. Orchestration

回答：

- 前端、后端、Agent 这套链路怎么跑起来
- 通用协议如何约定
- 具体业务场景如何把这些协议展开

### 2.1 Contracts

文档：

- [harness-scenario-response-contract.md](./02-orchestration/contracts/harness-scenario-response-contract.md)
- [agent-api-contract.md](./02-orchestration/contracts/agent-api-contract.md)
- [frontend-backend-agent-handoff.md](./02-orchestration/contracts/frontend-backend-agent-handoff.md)
- [agent-integration-matrix.md](./02-orchestration/contracts/agent-integration-matrix.md)

### 2.2 Scenarios

文档：

- [persona-workflow.md](./02-orchestration/scenarios/persona-workflow.md)
- [trend-tracking-workflow.md](./02-orchestration/scenarios/trend-tracking-workflow.md)
- [content-writing-workflow.md](./02-orchestration/scenarios/content-writing-workflow.md)

## 3. Implementation

回答：

- 这套 harness 在代码实现阶段到底怎么落
- 前端、后端、Agent 各自负责什么
- 运行时状态、上下文、工具、提示词边界怎么组织

### 3.1 Frontend

文档：

- [frontend-chat-page-harness-guidelines.md](./03-implementation/frontend/frontend-chat-page-harness-guidelines.md)
- [frontend-visual-guidelines.md](./03-implementation/frontend/frontend-visual-guidelines.md)
- [agent-output-copy-and-analytics.md](./03-implementation/frontend/agent-output-copy-and-analytics.md)
- [markdown-rendering-guidelines.md](./03-implementation/frontend/markdown-rendering-guidelines.md)
- [frontend-feedback-guidelines.md](./03-implementation/frontend/frontend-feedback-guidelines.md)
- [frontend-auth-guest-harness.md](./03-implementation/frontend/frontend-auth-guest-harness.md)

### 3.2 Backend

文档：

- [data-storage.md](./03-implementation/backend/data-storage.md)
- [auth-user-isolation.md](./03-implementation/backend/auth-user-isolation.md)

### 3.3 Agent

文档：

- [agent-context-plan.md](./03-implementation/agent/agent-context-plan.md)
- [docker-queue-runbook.md](./03-implementation/agent/docker-queue-runbook.md)
- [prompt-summary.md](./03-implementation/agent/prompt-summary.md)
- [tool-contract.md](./03-implementation/agent/tool-contract.md)
- [web-search-contract.md](./03-implementation/agent/web-search-contract.md)
- [openclaw-adapter-plan.md](./03-implementation/agent/openclaw-adapter-plan.md)
- [agent-service-runbook.md](./03-implementation/agent/agent-service-runbook.md)

## 4. Validation

回答：

- 当前做到哪
- 如何验收
- 已知错误如何记录与复盘
- 还有哪些实施项和交付项

文档：

- [harness-evaluation-plan.md](./04-validation/harness-evaluation-plan.md)
- [harness-error-log.md](./04-validation/harness-error-log.md)
- [markdown-rendering-evaluation.md](./04-validation/markdown-rendering-evaluation.md)
- [agent-delivery-checklist.md](./04-validation/agent-delivery-checklist.md)
- [agent-implementation-breakdown.md](./04-validation/agent-implementation-breakdown.md)

## 建议阅读顺序

如果是第一次接手，建议按这个顺序读：

1. [harness-overview.md](./01-foundation/harness-overview.md)
2. [formal-chat-scenarios-harness-architecture.md](./01-foundation/formal-chat-scenarios-harness-architecture.md)
3. [agent-architecture.md](./01-foundation/agent-architecture.md)
4. [harness-scenario-response-contract.md](./02-orchestration/contracts/harness-scenario-response-contract.md)
5. [frontend-backend-agent-handoff.md](./02-orchestration/contracts/frontend-backend-agent-handoff.md)
6. [persona-workflow.md](./02-orchestration/scenarios/persona-workflow.md)
7. [trend-tracking-workflow.md](./02-orchestration/scenarios/trend-tracking-workflow.md)
8. [content-writing-workflow.md](./02-orchestration/scenarios/content-writing-workflow.md)
9. [frontend-chat-page-harness-guidelines.md](./03-implementation/frontend/frontend-chat-page-harness-guidelines.md)
10. [frontend-visual-guidelines.md](./03-implementation/frontend/frontend-visual-guidelines.md)
11. [agent-output-copy-and-analytics.md](./03-implementation/frontend/agent-output-copy-and-analytics.md)
12. [markdown-rendering-guidelines.md](./03-implementation/frontend/markdown-rendering-guidelines.md)
13. [frontend-feedback-guidelines.md](./03-implementation/frontend/frontend-feedback-guidelines.md)
14. [frontend-auth-guest-harness.md](./03-implementation/frontend/frontend-auth-guest-harness.md)
15. [auth-user-isolation.md](./03-implementation/backend/auth-user-isolation.md)
16. [data-storage.md](./03-implementation/backend/data-storage.md)
17. [agent-context-plan.md](./03-implementation/agent/agent-context-plan.md)
18. [prompt-summary.md](./03-implementation/agent/prompt-summary.md)
19. [harness-evaluation-plan.md](./04-validation/harness-evaluation-plan.md)
20. [markdown-rendering-evaluation.md](./04-validation/markdown-rendering-evaluation.md)
21. [harness-error-log.md](./04-validation/harness-error-log.md)

## 当前主线

如果当前只关心 harness 一期主线，优先关注：

- 统一抽象是否成立
- 跨层调度 contract 是否清楚
- 三条正式业务主线是否遵守统一语义
- 灵光一闪是否已经按正式聊天页面纳入通用页面体系
- 登录态、游客门禁和用户数据隔离是否稳定
- 前端 / 后端 / Agent 的实现边界是否稳定
- 验收与错误复盘是否闭环

补充说明：

- “三条正式业务主线”当前指：人设打造、热门追踪、内容撰写
- “正式聊天页面体系”当前指：人设打造、热门追踪、内容撰写、灵光一闪 `/?view=dialog`
- `/data` 与 `/operation` 当前仍视为扩展页，不纳入正式聊天主线

## 固定术语

- `输出内容测试`
  - 在当前 harness 语境里，固定指“检查 mock / model 阶段输出是否正常，以及 discussion / 非 discussion 输出是否正常”的那组测试。
  - 旧文里如果出现“内容测试”“结果测评”“结果态类”等相近说法，默认都并入这个术语理解。
  - 这项测试的正式定义见 [harness-evaluation-plan.md](./04-validation/harness-evaluation-plan.md) 中的“输出内容测试”章节。
