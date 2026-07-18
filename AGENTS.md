# KOC 仓库协作约定

## 语言

- 默认使用中文沟通。

## 命令约束

- 禁止直接使用 `sudo`。
- 如果确实需要 `sudo`，必须先征求用户明确同意。

## 开发与部署约定

当前项目采用以下工作方式：

- 日常版本管理走本地 git
- 代码主要在本地开发、修改、测试
- 需要部署时，再同步到服务器
- 服务器是最终产品运行环境

当前推荐部署思路：

- 本地完成代码修改后，先在本地提交
- 需要更新服务器时，再 push 到服务器侧仓库或同步到服务器
- 服务器更新产品目录 `/home/fy/KOC`

注意：

- 服务器运行目录是最终产品目录
- 不要把服务器运行目录当作日常开发工作区
- 部署动作与本地开发动作分开处理

## 项目启动约定

- 默认通过 Docker 环境启动整个项目，不把手动本地直跑前端/后端作为标准启动方式。
- 统一使用仓库根目录的 `docker-compose.full.yml` 编排服务。
- 启动前应在仓库根目录执行命令，并确认本机已安装 Docker 与 Docker Compose。
- 多会话 / 多 Agent 场景下，禁止直接执行裸 `docker` 或 `docker compose`；必须统一通过 `python tools/docker_queue.py run ... -- <docker 命令>` 进入队列。
- `tools/docker_queue.py` 采用先来先到排队；若已有 Agent 正在启动 Docker 或执行一组 Docker 操作，后来者应收到占用提示，并每隔 5 秒轮询一次直到轮到自己。
- 需要把多条 Docker 命令视为同一批操作时，应使用 `--shell-command` 在一次持锁期间完成，避免中途被其他 Agent 插队。

推荐启动命令：

```bash
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up" -- docker compose -f docker-compose.full.yml up --build
```

如需后台启动：

```bash
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d
```

如需停止：

```bash
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose down" -- docker compose -f docker-compose.full.yml down
```

### 改完代码后如何看最新效果

- 不要默认每次都执行整套 `down + up --build -d`。
- 如果只是想恢复服务运行状态，优先使用 `restart`，不要重建镜像。
- 如果只改了某一个服务的代码，优先只重建该服务，而不是整套服务全部重建。
- 只有在修改了多个服务、基础依赖、Dockerfile 或 `docker-compose.full.yml` 时，才执行整套 `up --build -d`。

推荐用法：

```bash
# 只重启现有容器，不重建镜像
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose restart" -- docker compose -f docker-compose.full.yml restart

# 只重建前端
python tools/docker_queue.py run --session-id <agent-session-id> --label "frontend rebuild" -- docker compose -f docker-compose.full.yml up --build -d frontend

# 只重建后端
python tools/docker_queue.py run --session-id <agent-session-id> --label "backend rebuild" -- docker compose -f docker-compose.full.yml up --build -d backend

# 只重建 agent
python tools/docker_queue.py run --session-id <agent-session-id> --label "agent rebuild" -- docker compose -f docker-compose.full.yml up --build -d agent

# 整套重建
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up --build -d" -- docker compose -f docker-compose.full.yml up --build -d
```

按改动范围选择：

- 改 `frontend/`：重建 `frontend`
- 改 `backend/`：重建 `backend`
- 改 `agent/`：重建 `agent`
- 改 `docker-compose.full.yml`、基础镜像依赖或多个服务：整套重建
- 只是想看当前容器重新起来：`restart`

### 服务目录与职责

- 前端目录：`frontend/`
- 后端目录：`backend/`
- Agent 服务目录：`agent/`
- Nginx 配置目录：`deploy/nginx/`

### Docker 服务与端口

- `frontend`
  - 代码目录：`frontend/`
  - 容器端口：`3000`
  - 宿主机端口：`127.0.0.1:5000`
- `backend`
  - 代码目录：`backend/`
  - 容器端口：`8000`
  - 宿主机端口：`127.0.0.1:5001`
- `agent`
  - 代码目录：`agent/`
  - 容器端口：`8010`
  - 仅在 compose 内部网络供 `backend` 调用，默认不直接暴露到宿主机
- `mongo`
  - 容器端口：`27017`
  - 宿主机端口：`127.0.0.1:27017`
- `health`
  - 容器端口：`80`
  - 宿主机端口：`127.0.0.1:5002`
- `nginx`
  - 配置文件：`deploy/nginx/kocagent.conf`
  - 宿主机端口：`8928`

### 访问入口

- 前端直连入口：`http://127.0.0.1:5000`
- 后端健康检查：`http://127.0.0.1:5001/api/health`
- Nginx 聚合入口：`http://127.0.0.1:8928`

### 额外说明

- `frontend` 在 Docker 中通过 `API_PROXY_TARGET=http://backend:8000` 访问后端，不应改成容器内访问宿主机地址。
- `backend` 在 Docker 中通过 `AGENT_BASE_URL=http://agent:8010` 访问 Agent 服务。
- 如果是联调整个系统，优先检查并维护 Docker Compose 配置，而不是临时修改为本地散跑。

### 给 AI 的启动顺序

- 目标：当 AI 需要启动本项目时，默认启动整套 Docker Compose 环境，而不是只单独启动某一个本地进程。
- 工作目录：仓库根目录。
- 启动文件：`docker-compose.full.yml`。

推荐执行顺序：

1. 先确认将使用 Docker 方式启动，而不是本地直接运行 `frontend/`、`backend/` 或 `agent/`。
2. 在仓库根目录执行：

```bash
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d
```

3. 启动后按下面顺序检查服务是否正常：
   - 检查前端入口：`http://127.0.0.1:5000`
   - 检查后端健康接口：`http://127.0.0.1:5001/api/health`
   - 如需走统一入口，再检查：`http://127.0.0.1:8928`
4. 如果前端页面异常，先检查 `frontend` 容器是否正常。
5. 如果前端能打开但接口报错，先检查 `backend` 容器，再检查 `agent` 容器。
6. 如果后端健康接口异常，再检查 `mongo`、`backend`、`agent` 的容器状态和日志。
7. 只有在用户明确要求或 Docker 方案不可用时，才考虑临时使用本地直跑方式，并应明确告知用户这不是默认约定。

排查顺序：

- 页面打不开：先看 `frontend`，再看 `nginx`
- 页面能打开但接口失败：先看 `backend`
- 后端报 Agent 连接失败：看 `agent`
- 后端数据库相关异常：看 `mongo`

## 服务器信息

- Host: `119.29.132.10`
- User: `fy`
- 产品代码目录: `/home/fy/KOC`
- 当前本机已为该服务器配置 SSH 公钥，默认应直接使用 `ssh fy@119.29.132.10` 登录。
- 除非公钥登录失效、用户明确要求，或当前机器环境确实没有对应私钥，否则不要优先走密码登录。

## 文档约定

- 当前 `docs/` 目录应视为本项目的 harness 文档体系组成部分
- 新增或修改 harness 相关设计时，优先在 `docs/` 体系内维护，而不是散落在聊天记录中

## DevTrace 约定

- 本项目 DevTrace 根目录固定为 `E:\Visual Code\KOC\KOC\DevTrace`
- 开始涉及项目延续性工作的任务前，优先读取：
  - `E:\Visual Code\KOC\KOC\DevTrace\01_CURRENT.md`
  - `E:\Visual Code\KOC\KOC\DevTrace\02_BACKLOG.md`
  - `E:\Visual Code\KOC\KOC\DevTrace\00_INDEX.md`
- `01_CURRENT.md` 只记录当前主线、当前问题、当前 blocker 和近期下一步；用户提到“后续再做”“以后可以”“之后优化”“先记一下”这类未来目标时，优先记录到 `02_BACKLOG.md`
- 需要记录当前会话、续写项目事件、生成 review / 日报 / 周报 / 月报时，统一写入该目录
- 历史 Obsidian 风格笔记当前仍在 `E:\Visual Code\KOC\KOC` 下，需要参考旧记录时从该目录读取
- 如果新增项目级 DevTrace 约定或路径发生变化，必须同步更新：
  - 本文件
  - `E:\Visual Code\DevTrace\PROJECT_INDEX.md`

## 工作原则

- Iterate the loop untill you 100% confident of the current strategy。
- 始终保持代码库干净，没有临时文件、死代码、死文件。
- 始终保持组织化，没有不必要的文件夹、子文件夹、文件。
