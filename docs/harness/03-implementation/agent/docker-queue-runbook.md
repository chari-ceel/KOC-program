# Docker 队列运行约定

## 目的

当同一台机器上存在多个 Codex / Agent 会话时，Docker 启动、停止、重建、拉取镜像这类操作不能并发乱跑。

仓库统一通过 `tools/docker_queue.py` 提供 Docker 串行入口，解决以下问题：

- 有 Agent 正在执行 Docker 操作时，其他 Agent 要先收到占用提示
- 等待中的 Agent 每 5 秒轮询一次
- 多个 Agent 同时请求 Docker 时，按先来先到顺序排队
- 队列和当前占用状态对所有会话可见

## 标准用法

在仓库根目录执行：

```powershell
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose up -d" -- docker compose -f docker-compose.full.yml up --build -d
```

停止环境：

```powershell
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker compose down" -- docker compose -f docker-compose.full.yml down
```

把多条 Docker 操作作为同一批次执行：

```powershell
python tools/docker_queue.py run --session-id <agent-session-id> --label "docker deploy batch" --shell-command "docker compose -f docker-compose.full.yml pull; docker compose -f docker-compose.full.yml up --build -d"
```

查看当前队列：

```powershell
python tools/docker_queue.py status
```

查看 JSON 状态：

```powershell
python tools/docker_queue.py status --json
```

清理过期锁：

```powershell
python tools/docker_queue.py clear-stale
```

## 行为规则

- 所有 Docker 相关命令必须经由 `tools/docker_queue.py`
- 队列遵循 FIFO
- 等待中的 Agent 每 5 秒打印一次当前位次和占用者
- 正在执行的 Agent 会持续刷新心跳，防止锁误释放
- 若持锁进程已退出或长时间无心跳，后续 Agent 会自动清理过期锁
- 如果多条 Docker 命令必须视为一组原子操作，应使用 `--shell-command`，在同一次持锁期间执行完整批次

## 状态文件

状态目录：

```text
.codex/docker-queue/
```

包含：

- `queue.json`：等待队列
- `lock.json`：当前持锁者
- `.fslock`：文件级互斥锁

这些文件只用于本机多会话协调，不属于业务数据，也不应提交到 git。
