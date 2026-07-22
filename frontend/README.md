## 启动方式

本项目默认不使用前端本地 `npm run dev` 作为标准启动方式。

标准方式是回到仓库根目录，通过 Docker Compose 启动整套环境：

```bash
docker compose -f docker-compose.full.yml up --build -d
```

默认访问入口：

- 前端直连：`http://127.0.0.1:5000`
- Nginx 聚合入口：`http://127.0.0.1:8928`

说明：

- `frontend/` 容器内部仍监听 `3000`，但这是容器内端口，不是默认给开发者直接访问的入口。
- 日常联调、harness 验证和问题复现，统一以 Docker Compose 环境和 `127.0.0.1:5000` 为准。
- 只有在用户明确要求或 Docker 不可用时，才考虑临时本地直跑前端。

## Feature Flags

- `NEXT_PUBLIC_SHOW_PROMPT_DEBUG=false`
  控制侧边栏是否显示 `Prompt调试` 入口。当前只有显式设为 `true` 时才会显示。

- `NEXT_PUBLIC_SHOW_ANALYSIS_MODULES=false`
  控制是否显示 `数据分析` 和 `运营规划` 两个板块。设为 `false` 时，侧边栏会隐藏这两个入口，直接访问对应 URL 也会跳回首页。

## 补充说明

- 统一对话页不再使用假接口或前端伪造流程状态；登录用户的消息、阶段、摘要、完成状态、按钮和草稿标题都以后端 `/api/agent/chat`、`/api/agent/conversations` 返回为准。
- `frontend/app/api/agent/[...path]/route.ts` 会把浏览器侧 `/api/agent/*` 请求真实转发到后端，并保留 cookie；该 route 只做代理和超时错误提示，不生成假 Agent 内容。
- Docker 环境下前端通过 `API_PROXY_TARGET=http://backend:8000` 访问后端；本地临时直跑前端时默认转发到 `http://127.0.0.1:5001`。
- 如果只打开 `http://localhost:3000`，必须确认后端 `http://127.0.0.1:5001/api/health` 正常，否则统一对话会显示请求失败。
- 如果页面异常，先检查根目录 `docker-compose.full.yml` 对应的 `frontend`、`backend`、`agent`、`mongo` 服务状态，而不是先切回本地散跑。
