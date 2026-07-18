\# KOC Agent



KOC Agent 是一个面向内容创作、画像分析、热点追踪的全栈项目。

项目默认通过 Docker Compose 启动，包含前端、后端、Agent 服务、MongoDB 和 Nginx 聚合入口。



\## 快速启动



```powershell

docker compose -f docker-compose.full.yml up --build -d

访问入口

前端：http://127.0.0.1:5000

后端健康检查：http://127.0.0.1:5001/api/health

Nginx 聚合入口：http://127.0.0.1:8928

服务结构

frontend/：前端界面

backend/：业务后端

agent/：独立 Agent 服务

docs/：项目文档与 harness 说明

prompts/：提示词模板

tools/：辅助脚本

本地开发

默认推荐通过仓库根目录的 Docker Compose 启动整套环境。

只有在明确需要单独调试某个模块时，才考虑单独启动前端、后端或 Agent。

协作方式

主分支保持稳定

每个功能使用独立分支开发

开工前先 git pull

完成后提交并推送，再发 Pull Request 合并

推荐流程：

git checkout -b feature/xxx

\# 修改代码

git add .

git commit -m "Add xxx"

git push -u origin feature/xxx

配置说明

本地配置放在 .env

不要提交真实密钥

如需参考环境变量，请查看各模块的 README 和文档

