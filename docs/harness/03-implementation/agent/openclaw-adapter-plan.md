# OpenClaw 适配计划

## 目标

本文档说明 KOC Agent 是否以及如何基于 OpenClaw 或 OpenClaw-like runtime 进行改造。

当前结论：

```text
OpenClaw 可以作为 Agent runtime 和工具调度底座候选。
KOC 的业务 workflow、prompt、schema、工具协议必须保留在 KOC Agent 模块内。
```

这样做的原因是：

- demo 阶段需要尽快跑通人设打造、热门追踪、内容撰写。
- 后续工具来源、抓取能力、上下文检索和多 Agent 都还没有完全确定。
- 如果一开始把业务逻辑深度写死在 OpenClaw 内部，后期替换成本会变高。

## 适配边界

### OpenClaw 可以负责

- Agent runtime。
- 工具注册。
- 工具调用编排。
- 模型调用封装。
- 对话或任务执行链路。
- 运行日志和 tracing，视 OpenClaw 能力而定。

### KOC Agent 必须自己保留

- `taskType` 路由。
- `docs/harness/02-orchestration/contracts/agent-api-contract.md` 中定义的请求和返回 envelope。
- `docs/harness/03-implementation/agent/tool-contract.md` 中定义的工具协议。
- `docs/harness/02-orchestration/scenarios/` 中定义的一期 workflow。
- `prompts/` 中定义的 prompt 规范。
- `savePayload` 生成规则。
- 小红书图文笔记的一期业务约束。
- 前后端交接文档和 mock。

## 推荐架构

```text
后端 Agent Adapter
→ KOC Agent API 层
→ Task Router
→ KOC Workflow
→ Prompt Builder
→ Runtime Adapter
→ OpenClaw 或自研轻量 runtime
→ Tool Registry
→ RetrievalTool / ContextProviderTool / AgentMemoryTool
```

关键点：

```text
OpenClaw 放在 Runtime Adapter 后面。
后端永远只知道 KOC Agent API。
```

这样即使未来不用 OpenClaw，后端接口也不需要改。

## `RetrievalTool` 映射方式

KOC 侧统一工具请求：

```json
{
  "toolType": "retrieval",
  "source": "web_search",
  "query": "小红书 大学生成长 热门选题",
  "platform": "xiaohongshu",
  "limit": 10,
  "filters": {},
  "timeoutMs": 8000
}
```

OpenClaw 侧可以映射为：

```text
tool name: retrieval.search
tool input: KOC RetrievalToolRequest
tool output: KOC RetrievalToolResult
```

映射原则：

- KOC schema 不跟随 OpenClaw 内部字段变化。
- OpenClaw 工具返回结果必须被转换成 `docs/harness/03-implementation/agent/tool-contract.md` 中的统一结构。
- 工具调用记录必须写入 `toolCalls`。
- 工具来源必须写入 `sources`，如果来源真实可追溯。

## Workflow 映射方式

KOC workflow 不直接依赖 OpenClaw。

建议封装：

```text
PersonaWorkflow
TrendTrackingWorkflow
ContentWritingWorkflow
```

每个 workflow 内部只依赖抽象接口：

```text
ModelRuntime
ToolRegistry
PromptBuilder
```

OpenClaw 只作为 `ModelRuntime` 和 `ToolRegistry` 的一种实现。

## 如果 OpenClaw 不适合

如果验证后发现 OpenClaw 不适合一期 demo，可以切到自研轻量 runtime。

迁移方式：

1. 保留 `POST /agent/run` 不变。
2. 保留 `taskType` 路由不变。
3. 保留 prompt 文件不变。
4. 保留 `RetrievalTool` 协议不变。
5. 替换 `Runtime Adapter`。

自研轻量 runtime 最小能力：

- 根据 prompt 调模型。
- 注册和调用工具。
- 捕获工具错误。
- 生成 `toolCalls`。
- 支持 mock 模式。

## 采用 OpenClaw 前需要验证的问题

### 接口稳定性

- OpenClaw 是否支持自定义 HTTP envelope？
- 是否容易把返回结果包装成 `data`、`savePayload`、`sources`、`toolCalls`？

### 工具扩展

- 是否支持统一注册 `RetrievalTool`？
- 是否支持工具超时、失败、重试和降级？
- 是否能保留工具调用日志？

### Prompt 管理

- 是否允许 KOC 自己管理 prompt 文件？
- 是否支持按 `taskType` 选择不同 prompt？

### 多 Agent 预留

- 是否支持后续拆出视频规划、热点投递、内容优化等专家 Agent？
- 是否支持当前一期先单 Agent，后续再扩展多 Agent？

### 部署和调试

- 是否适合本地独立运行？
- 是否方便后端通过 HTTP 调用？
- 是否方便 Docker 化？

## 主要风险

### 风险一：过早绑定框架

如果直接把 KOC 业务逻辑写入 OpenClaw 内部，后期替换框架会影响前后端联调。

缓解：

```text
所有业务协议先放在 KOC Agent 层，OpenClaw 只作为 adapter。
```

### 风险二：工具能力未确定

搜索、浏览、抓取、小红书数据接口都还未最终确定。

缓解：

```text
先定义 RetrievalTool 抽象，用 mock_retrieval 跑通流程。
```

### 风险三：多 Agent 提前复杂化

一期只需要一个 Agent 跑通三模块。

缓解：

```text
一期单 Agent + taskType router，后续通过 AgentRegistry 拆分专家 Agent。
```

## 一期建议

一期不要先深度魔改 OpenClaw。

更短路径：

1. 先完成 KOC Agent API、workflow、prompt、tool contract。
2. 用 mock runtime 或轻量 runtime 跑通 `/agent/run`。
3. 再验证 OpenClaw 是否适合作为 runtime adapter。
4. 如果合适，再把工具注册和模型调用迁移到 OpenClaw。

这能保证五天 demo 不被框架适配拖住，同时保留后续基于 OpenClaw 魔改的空间。
