# KOC Agent

面向小红书内容创作的全栈项目，覆盖人设打造、热门追踪、内容撰写和图文指导。

## 当前重点

- Agent 采用“主 Agent 统一调度 + 子 Agent 分工执行”的后端方案
- 搜索能力只接公开数据，结果返回来源与摘要，不伪造来源
- 模型路由采用固定角色映射，前端不参与调度
- 首页侧边栏的“灵光”入口已替换为“用户说明书”

## 结构

- `frontend/`：前端界面
- `backend/`：业务后端
- `agent/`：Agent 服务
- `docs/`：项目文档与历史 PRD / harness 说明
- `prompts/`：提示词模板
- `tools/`：辅助脚本

## 启动

```powershell
docker compose -f docker-compose.full.yml up --build -d
```

访问地址：

- 前端：`http://127.0.0.1:5000`
- 后端健康检查：`http://127.0.0.1:5001/api/health`
- Nginx 聚合入口：`http://127.0.0.1:8928`

## 本地开发

默认建议通过仓库根目录的 Docker Compose 启动整套环境。
只有在明确需要单独调试某个模块时，才单独启动前端、后端或 Agent。

## 协作

- 使用功能分支开发，合并前通过 Pull Request 检查
- Agent 调度改动主要集中在 `agent/` 和 `backend/app/adapters/agent/`
- 前端 UI 与用户说明书改动主要集中在 `frontend/`

## 配置

- 本地配置放在 `.env`
- 不要提交真实密钥
- 需要参考环境变量时，查看各模块 README 和文档

