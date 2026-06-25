# agent-orchestrator

[English](https://github.com/vndmea/agent-orchestrator/blob/master/README.md) | 简体中文

`agent-orchestrator` 是一个面向多模型工程工作流的 TypeScript 编排服务。它围绕 leader-worker 协作、确定性验证，以及通过 CLI 和 MCP server 提供的轻量交付接口来设计。

## 这是什么

- 一个使用 TypeScript / Node.js 构建的 monorepo，用于编排 leader 与 worker agent
- 一个可以被人类或其他 coding agent 通过 shell 命令调用的 CLI
- 一个以结构化工具形式暴露编排能力的 MCP server
- 一个默认以 dry-run 模式运行的安全工作流引擎

## 这不是什么

- 不是 Codex、OpenCode、Cursor 或 Claude Code 的克隆
- 不是交互式 coding terminal 或 TUI
- 不是完整的聊天界面
- 不是 Web UI 产品

## 架构图

```text
Human / Coding Agent / CI / MCP Client
                |
                v
           ao CLI / MCP
                |
                v
         LangGraph Workflows
                |
      +---------+---------+
      |                   |
      v                   v
 Leader Agent      Deterministic Tools
      |
      v
 Worker Agents
```

## Monorepo 结构

```text
packages/
  core/
  models/
  graph/
  tools/
  mcp-server/
  cli/
apps/
  playground/
examples/
  leader-worker-basic/
docs/
```

## 初始化与检查

```bash
pnpm install
pnpm typecheck
pnpm test
```

## CLI 用法

```bash
ao plan --goal "Generate TipTap nodes from S1000D proced.xsd"
ao run leader-worker-basic --goal "Generate tests for schema parser"
ao review repo --scope packages/graph
ao review diff --base main --head HEAD
ao review files --file packages/graph/src/index.ts
ao validate --typecheck --lint --test
ao fix error --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
ao models list
ao mcp serve
ao mcp list-tools
```

## Worker 接入评估

系统不会因为某个模型 endpoint 可用，就默认把它视为合格的 worker。

在分配真实任务前，先执行接入评估：

```bash
ao worker interview --provider litellm --model qwen3-coder
ao worker interview --provider litellm --model qwen3-coder --save
ao worker list
ao worker profile litellm:qwen3-coder
```

这套 interview 会评估：

- 指令遵循能力
- 结构化 JSON 输出能力
- 摘要能力
- 代码理解能力
- 简单 TypeScript 代码生成能力
- 置信度校准能力

评估结果会生成 `WorkerCapabilityProfile`，并直接影响路由：

- `active`：可以接收其通过评估的任务类型
- `limited`：只允许低风险任务，并且需要 leader review
- `blocked`：禁止进入生产工作流，并输出告警

示例告警输出：

```text
Worker litellm:qwen3-coder failed onboarding evaluation.

Status: limited

Reasons:
- structured-output: Output failed schema validation.
- codegen: Generated code uses any.
- confidence-calibration: Worker reported high confidence on an ambiguous task.

Recommended action:
- Do not assign codegen tasks.
- Limit this worker to qualified low-risk tasks.
- Require leader review for every accepted output.
```

如果 worker 表现更差，profile 会被标记为 `blocked`，生产路由应将其视为不可用。

### 持久化 worker profile

如果你希望把这次评估结果保存下来，可以使用 `--save`：

```bash
ao worker interview --provider litellm --model qwen3-coder --save
```

保存后的 profile 会写到：

```text
.ao/worker-profiles.json
```

你可以通过下面的命令查看这些已保存的 profile：

```bash
ao worker list
ao worker profile litellm:qwen3-coder
```

当前行为仍然偏保守：如果 workflow 启动时没有显式传入 profile object，系统可以重新执行 interview，而不是盲目信任旧的能力记录。

## Worker registry 流程

先注册可复用 worker，再做 interview，并在真正执行时显式引用它：

```bash
ao worker register \
  --provider litellm \
  --model qwen3-coder \
  --base-url http://localhost:4000/v1 \
  --api-key-env-var LITELLM_API_KEY \
  --allow-write

ao worker interview --worker litellm:qwen3-coder --save

ao run leader-worker-workflow \
  --goal "Review this repository" \
  --worker litellm:qwen3-coder \
  --require-profile

ao audit list
```

这条链路强调本地注册、能力画像持久化，以及可审计的显式分配。

## 仓库 review 流程

日常工程检查建议直接使用专用命令：

```bash
ao review repo --scope packages/graph
ao review diff --base main --head HEAD
ao review files --file packages/graph/src/index.ts
ao validate --typecheck --lint --test
ao fix error --error-log-file ./tmp/tsc-error.log --scope packages/core
```

这些命令会构建 repository context pack、安全读取 scope 内文件，并把确定性验证结果并入 review 输出。

## MCP server 用法

启动 stdio server：

```bash
ao mcp serve
```

列出当前暴露的工具名：

```bash
ao mcp list-tools
```

## 环境变量

参见 [.env.example](https://github.com/vndmea/agent-orchestrator/blob/master/.env.example)。

- `LEADER_MODEL_PROVIDER`
- `LEADER_MODEL_NAME`
- `LEADER_MODEL_BASE_URL`
- `LEADER_MODEL_API_KEY`
- `WORKER_MODEL_PROVIDER`
- `WORKER_MODEL_NAME`
- `WORKER_MODEL_BASE_URL`
- `WORKER_MODEL_API_KEY`
- `LITELLM_BASE_URL`
- `LITELLM_API_KEY`
- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`
- `AO_DRY_RUN`
- `AO_ALLOW_WRITE`
- `AO_ALLOWED_COMMANDS`

## 内置工作流

- `planning-workflow`：生成任务计划、worker 分配建议、风险列表和验证策略
- `leader-worker-workflow`：协调 leader 规划、worker 执行、工具验证与最终审查
- `review-workflow`：汇总 diff 影响、风险、缺失测试与后续项
- `fix-error-workflow`：分析错误日志并给出以验证为导向的安全修复建议
- `worker-interview-workflow`：在生产路由前评估 worker 模型，并生成能力画像

## 运行基础示例

```bash
pnpm example:leader-worker-basic
```

## 如何添加新的 worker

1. 在 `packages/graph/src/workers` 下新增 worker class。
2. 为它定义清晰的 `WorkerCapability`，并使用 Zod schema 描述输入输出。
3. 声明它支持的任务类型，让路由层能够执行能力限制。
4. 在工作流中接入它，并保证输出是可审查的。
5. 确保 onboarding interview 的结果可以约束它的任务分配。
6. 为受影响的工作流路径补上测试。

## 如何添加新的 workflow

1. 在 `packages/graph/src/workflows` 下创建新的 workflow 文件。
2. 使用 LangGraph.js 显式建模状态流转。
3. 复用 core contracts 和 leader review 模式。
4. 只有在补齐测试后，再通过 CLI 或 MCP 暴露出去。

## 如何添加新的 MCP tool

1. 在 `packages/mcp-server/src/tools` 下新增 tool definition。
2. 保持 handler 足够薄，把业务逻辑委托给 core workflow API。
3. 在 `packages/mcp-server/src/server.ts` 中注册。
4. 补充对应的注册测试。

## 如何配置 LiteLLM

将 `LEADER_MODEL_PROVIDER=litellm` 或 `WORKER_MODEL_PROVIDER=litellm`，并提供：

- `LITELLM_BASE_URL`
- `LITELLM_API_KEY`

如果你希望 leader 和 worker 走不同的 endpoint，也可以改用各自的 model-specific base URL 变量。

## 安全模型

- 默认模式是 dry-run。
- 文件写入需要显式的策略授权。
- Shell 执行通过 allowlist 控制。
- 仓库读取必须留在 repo root 内，并会阻止 `.env`、私钥等 secret-like 文件进入上下文。
- 专用 review / fix 流程只返回结构化 JSON，不会自动应用 patch。
- validation 命令统一走安全命令路径，相关行为可通过 audit log 追踪。
- `ao audit list` 可查看本地 workflow、文件与命令事件。
- Worker 输出在 leader review 完成前都不能视为最终结果。
- Worker 在进入生产任务前应先通过 onboarding evaluation。
- structured output 或可靠性不达标的 worker 会被限制或阻断。
- 密钥应通过环境变量提供，且绝不能写入日志。

## Roadmap

- 扩展更多 workflow 覆盖和更丰富的确定性验证能力
- 后续增加领域专项编排包
- 增加 CI 自动化检查与发布能力
- 保持核心聚焦在 orchestration，而不是 UI
