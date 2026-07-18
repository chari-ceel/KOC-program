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

- 前端通过 `API_PROXY_TARGET=http://backend:8000` 访问后端。
- 如果页面异常，先检查根目录 `docker-compose.full.yml` 对应的 `frontend`、`backend`、`agent`、`mongo` 服务状态，而不是先切回本地散跑。
