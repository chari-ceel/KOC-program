# Harness 错误归档

## 说明

本文档用于记录 harness 测评或日常联调中发现的错误。

它不是简单的报错堆积区，而是当前 harness 体系下的错误检索与复盘入口。

记录目标：

- 保留原始报错
- 归一化错误名称
- 标注问题层级
- 记录解决办法
- 建立相似问题索引

配套测评方案见：

- [harness-evaluation-plan.md](./harness-evaluation-plan.md)

## 使用规则

每条错误记录建议：

1. 使用唯一 `error_id`
2. 明确 `scenario` 与 `action`
3. 保留 `raw_error`
4. 给出 `normalized_error`
5. 记录 `possible_cause`
6. 记录 `suggested_fix`
7. 如果已解决，补 `resolution`
8. 如果有历史相似问题，补 `similar_cases`

## 推荐字段

- `error_id`
- `time`
- `scenario`
- `action`
- `layer`
- `symptom`
- `raw_error`
- `normalized_error`
- `possible_cause`
- `suggested_fix`
- `resolution`
- `similar_cases`
- `repro_steps`
- `status`

## 推荐枚举

### `scenario`

- `global`
- `persona`
- `trend`
- `content`

### `layer`

- `frontend-ui`
- `frontend-state`
- `backend-api`
- `backend-service`
- `agent-runtime`
- `agent-tool`
- `network`
- `data-storage`
- `unknown`

### `normalized_error`

- `AGENT_UNAVAILABLE`
- `AGENT_BAD_RESPONSE`
- `BACKEND_TIMEOUT`
- `BACKEND_ROUTE_ERROR`
- `NETWORK_SEARCH_UNAVAILABLE`
- `INVALID_RESULT_SHAPE`
- `SAVE_FAILED`
- `SESSION_STATE_CONFLICT`
- `DELETE_STATE_CONFLICT`
- `UNKNOWN_RUNTIME_ERROR`

### `status`

- `new`
- `confirmed`
- `fixing`
- `resolved`
- `cannot_repro`

## 检索建议

遇到新问题时，优先按以下顺序检索已有记录：

1. `normalized_error`
2. `layer`
3. `scenario`
4. `action`
5. `resolution`

如果能命中相似问题，应优先复用已有排查路径和解决办法，而不是重新从零定位。

## 错误记录模板

```yaml
error_id: ERR-TREND-001
time: 2026-05-18 15:20
scenario: trend
action: 创建新的热门追踪
layer: agent-runtime
symptom: 点击发送后前端提示 Agent 调用失败
raw_error: Connection refused to AGENT_BASE_URL
normalized_error: AGENT_UNAVAILABLE
possible_cause: Agent 服务未启动或端口错误
suggested_fix: 检查 agent 服务状态、端口与 AGENT_BASE_URL 配置
resolution: 启动 agent 服务，并将后端环境变量中的 AGENT_BASE_URL 改为正确端口
similar_cases:
  - ERR-GLOBAL-002
repro_steps:
  - 打开热门追踪页
  - 输入“大学生成长赛道”
  - 点击发送
status: confirmed
```

## 错误记录

### ERR-TEMPLATE-001

```yaml
error_id: ERR-TEMPLATE-001
time: YYYY-MM-DD HH:mm
scenario: global
action: 示例动作
layer: unknown
symptom: 示例现象
raw_error: 示例原始报错
normalized_error: UNKNOWN_RUNTIME_ERROR
possible_cause: 示例原因
suggested_fix: 示例排查方向
resolution: 待填写
similar_cases: []
repro_steps:
  - 第一步
  - 第二步
status: new
```

### ERR-GLOBAL-001

```yaml
error_id: ERR-GLOBAL-001
time: 2026-05-19 00:10
scenario: global
action: 非默认地本地直跑前端并在 Codex in-app browser 中打开 profile / trending / content 页面
layer: frontend-ui
symptom: 前端页面偶发无法打开、反复停留在旧的错误页，或浏览器看起来还在访问 127.0.0.1:3001/trending
raw_error: ERR_CONNECTION_REFUSED / 无法访问此站点 / 页面长期停留在旧错误页
normalized_error: UNKNOWN_RUNTIME_ERROR
possible_cause: 本地同时存在多个 next dev 进程，导致端口从 3000 漂移到 3001；in-app browser 复用了旧错误页签；Next dev 对 127.0.0.1 的本地来源放行不稳定
suggested_fix: 默认不要使用本地前端 dev server 作为 harness 联调入口；应统一改回 Docker Compose，并从 `http://127.0.0.1:5000` 或 `http://127.0.0.1:8928` 进入；如果确实临时本地直跑，再清理多余 dev 进程并单独处理 Next dev 配置
resolution: 当前 harness 默认入口已统一改为 Docker Compose + `http://127.0.0.1:5000`；本条保留为历史问题，提醒不要再把 `localhost:3000` 当默认联调入口
similar_cases: []
repro_steps:
  - 非默认地启动多个前端 dev 进程
  - 在浏览器中先打开失败的 127.0.0.1:3001/trending
  - 再继续复用该旧页签做联调
status: resolved
```

### ERR-GLOBAL-002

```yaml
error_id: ERR-GLOBAL-002
time: 2026-05-19 00:20
scenario: global
action: 在 backend 目录执行全量 pytest
layer: backend-service
symptom: 测试运行时报 from backend... 导入路径错误，导致 pytest 不能正常收集或执行用例
raw_error: ModuleNotFoundError / ImportError: from backend... 导入路径报错
normalized_error: UNKNOWN_RUNTIME_ERROR
possible_cause: backend 目录缺少稳定的 pytest 导入路径配置，测试进程启动时没有把项目根或 backend 包正确加入 Python path
suggested_fix: 为 backend 补充 pytest.ini，并在 backend/tests/conftest.py 中显式处理测试导入路径
resolution: 已新增 backend/pytest.ini 与 backend/tests/conftest.py；本地执行 cd backend && python -m pytest 后通过，结果为 7 passed
similar_cases: []
repro_steps:
  - 进入 backend 目录
  - 执行 python -m pytest
  - 观察测试收集阶段的导入报错
status: resolved
```

### ERR-CONTENT-001

```yaml
error_id: ERR-CONTENT-001
time: 2026-05-19 01:05
scenario: content
action: 从热门追踪页点击选题，跳转到 /content?topic=...&auto=1 自动起稿
layer: frontend-state
symptom: 内容页能接住 topic 和 auto=1，但页面没有稳定自动起稿，或刚进入 chat 视图后又被旧草稿状态覆盖
raw_error: 无显式接口报错；表现为跳转成功但自动起稿未落出，页面仍停留在旧会话/旧草稿上下文
normalized_error: SESSION_STATE_CONFLICT
possible_cause: content 页面在处理 auto=1 自动起稿时，同时又执行了本地 sessionStorage 中旧聊天状态和 ACTIVE_DRAFT 的恢复逻辑，导致自动起稿状态被旧会话覆盖
suggested_fix: 自动起稿前清理 ACTIVE_DRAFT_STORAGE_KEY、CONTENT_CHAT_STATE_STORAGE_KEY、CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY；自动起稿进行中禁止 applyStoredChatState/openDraft 恢复旧状态；起稿完成后去掉 URL 中的 auto=1 避免重复触发
resolution: 已在 frontend/app/content/page.tsx 中提高 auto=1 自动起稿优先级，阻断旧会话恢复竞争；手测确认从 trending 点击“大学生第一次考证最容易踩的 5 个坑”后，content 页面会自动进入生成态并落出完整草稿、suggestions 与保存入口
similar_cases:
  - ERR-GLOBAL-001
repro_steps:
  - 在热门追踪页打开一条含选题的历史记录
  - 点击某个选题按钮跳转到 /content?topic=...&auto=1
  - 观察是否自动进入生成态，或是否被旧草稿/旧会话顶回
status: resolved
```

### ERR-GLOBAL-003

```yaml
error_id: ERR-GLOBAL-003
time: 2026-05-24 10:35
scenario: global
action: 在 frontend 目录执行 npm run lint
layer: unknown
symptom: eslint 会扫描 `frontend/.release-stage/.next/**` 下的 Next.js / Turbopack 构建产物，报出大量 require、module、@ts-ignore、no-this-alias 等错误，干扰对真实前端源码的校验
raw_error: A `require()` style import is forbidden / Do not assign to the variable `module` / Use "@ts-expect-error" instead of "@ts-ignore"
normalized_error: UNKNOWN_RUNTIME_ERROR
possible_cause: 当前 lint 范围没有排除 `frontend/.release-stage/.next/` 这类自动生成的构建输出目录，导致 ESLint 按业务源码规则检查编译产物
suggested_fix: 后续补充 ESLint ignore 规则，排除 `frontend/.release-stage/.next/**` 及同类构建产物目录，避免生成文件污染源码校验结果
resolution: 稍后解决；当前先记录为已确认问题，后续统一整理前端 lint / ignore 配置时处理
similar_cases: []
repro_steps:
  - 进入 frontend 目录
  - 执行 npm run lint
  - 观察报错是否主要来自 .release-stage/.next 下的自动生成文件
status: confirmed
```
