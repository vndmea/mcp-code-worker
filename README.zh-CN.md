# mcp-code-worker

[English](https://github.com/vndmea/mcp-code-worker/blob/master/README.md) | [简体中文](https://github.com/vndmea/mcp-code-worker/blob/master/README.zh-CN.md)

`mcp-code-worker` 是一个面向多模型工程工作流的 TypeScript 编排运行时。它的核心职责是把 worker 调用、仓库上下文收敛、确定性验证、patch gate 和本地任务产物放进一个可控的执行层里。

## 这是什么

- 一个使用 TypeScript / Node.js 构建的 monorepo，用于编排 worker 执行、验证和任务产物
- 一个可以被人类或其他 coding agent 通过 shell 命令调用的 CLI
- 一个以结构化工具形式暴露编排能力的 MCP server
- 一个默认以 dry-run 模式运行的安全工作流引擎
- 一个把 repository reads、patch 生命周期、worker 资格和 audit 收口的本地执行层

## 这不是什么

- 不是 Codex、OpenCode、Cursor 或 Claude Code 的克隆
- 不是交互式 coding terminal 或 TUI
- 不是完整的聊天界面
- 不是 Web UI 产品

## 宿主关系

在 Codex 这类宿主驱动场景里，`cw` 只是受控执行层，不替代宿主做最终判断。

- 宿主负责理解用户目标、决定是否接受结果。
- `cw` 负责受控执行：worker 路由、repository context、确定性验证、artifact 持久化、patch gate。
- 对宿主来说，`cw` 的推荐入口是 `cw_start_task` 和其他 host-managed tools。
- 对于窄范围、repo-grounded 的检查，优先使用显式文件列表配合 strict file mode，这样 `cw` 会在证据不完整时直接失败，而不是悄悄放大范围或跳过关键文件。

## 架构图

```text
Human / Coding Agent / CI / MCP Client
                |
                v
           cw CLI / MCP
                |
                v
      Orchestration Runtime
      |            |        \
      v            v         v
 Worker Routing  Deterministic Tools  CW Storage / Artifacts
      |
      v
 Worker Models / Local Clients
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
  host-worker-basic/
docs/
```

## 运行要求

- Node.js `22`
- pnpm `>=10`

当前 CI 只验证 Node 22。其他 Node.js `>=22` 版本暂时属于 best-effort，只有进入 CI matrix 后才视为正式验证。

明确的 OS、Node.js 和 MCP host 支持边界见 [docs/supported-matrix.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/supported-matrix.md)。

## 安装

全局 npm 安装：

```bash
npm i -g mcp-code-worker
cw init
cw doctor
cw mcp list-tools
```

仓库开发安装：

```bash
pnpm install
pnpm build
pnpm exec cw doctor
pnpm exec cw init
pnpm exec cw doctor
pnpm typecheck
pnpm test
```

## 首次使用

```bash
cw init
cw doctor --probe
cw mcp config
```

公开安装和 MCP 启动路径见 [docs/install.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/install.md)。
当前官方内部交付形态见 [docs/distribution.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/distribution.md)。

除非特别说明，下面所有 `cw ...` 示例都按公开 npm 安装后的 CLI 理解；如果你在仓库 checkout 中开发，则等价于在仓库根目录执行 `pnpm exec cw ...`。

默认建议使用 `cw init` 完成初始化；你可以直接交互式运行，也可以通过 `cw init --preset mock --allow-write`、`cw init --preset deepseek --allow-write`、`cw init --preset opencode --allow-write` 这类 preset 先快速落地，再按需调整更底层的 flags。

当前版本不会读取仓库内旧 `.cw/` 目录；旧路径不受支持，也不会被兼容处理。

`cw init` 默认会在 `~/.code-worker/<workspace-id>/` 下创建用户级 CW 工作区存储：

- `config.json`
- `data.db`

其中 `config.json` 保存可编辑的 worker 定义和运行时默认值，`data.db`
则作为 SQLite 存储，承载 worker secret、worker profile、每个 worker / suite
最新一条 benchmark 结果、task session、task artifact 和 audit event。

## CLI 用法

```bash
cw review repo --worker qwen-local --scope packages/graph
cw review diff --worker qwen-local --base main --head HEAD
cw review files --worker qwen-local --file packages/graph/src/index.ts --strict-files
cw validate --all
cw validate --all --stop-on-failure --execute
cw fix error --worker qwen-local --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
cw task start --goal "Fix failing typecheck" --scope packages/core --worker qwen-local --typecheck --error-log-file ./tmp/tsc-error.log --run-fix --allow-write-session
cw task report <taskId>
cw cleanup runs
cw cleanup audit
cw models list
cw mcp config
cw mcp serve
cw mcp list-tools
```

`cw review files --strict-files` 和 `cw_run_host_worker` 现在会暴露 host-managed worker 调试证据，包括 requested files、selected files、worker metadata，以及 structured output 失败细节。

## Worker 接入评估

系统不会因为某个模型 endpoint 可用，就默认把它视为合格的 worker。

> Warning:
> 较弱的 worker 模型并不会天然省 token。如果宿主仍然需要大量复核、改写，甚至重做它的输出，总 token 成本往往会上升而不是下降。
> 真正更省的场景通常是窄范围、机械化、低风险、易验证的任务，例如跑检查、提取字段、收集日志、或对很小范围输入做摘要。

默认首次接入走 `cw init`。如果你需要显式高级流程，再先注册一个用户命名的 worker，然后再做评估：

```bash
cw worker register \
  --worker qwen-local \
  --provider litellm \
  --model qwen3-coder \
  --base-url http://localhost:4000/v1 \
  --allow-write

cw worker interview --worker qwen-local --save
cw worker list
cw worker profile qwen-local
```

这套 interview 会评估：

- 指令遵循能力
- 结构化 JSON 输出能力
- 严格作用域约束能力
- 摘要能力
- 证据链式仓库 review 能力
- 关键证据不足时的拒答能力
- 代码理解能力
- 简单 TypeScript 代码生成能力
- 置信度校准能力

评估结果会生成 `WorkerCapabilityProfile`，并直接影响路由：

- `qualified`：可以接收其通过评估的任务类型
- `not-qualified`：评估已完成，但仍不具备进入合格任务类型的能力

示例告警输出：

```text
Worker qwen-local failed onboarding evaluation.

Status: not-qualified

Reasons:
- structured-output: Output failed schema validation.
- codegen: Generated code uses any.
- confidence-calibration: Worker reported high confidence on an ambiguous task.

Recommended action:
- Do not assign codegen tasks.
- Limit this worker to qualified low-risk tasks.
- Require host review for every accepted output.
```

如果因为配置或连通性问题导致评估无法完成，访谈结果不会被持久化，生产路由应在问题修复前将该 worker 视为不可用。

### 持久化 worker profile

如果你希望把这次评估结果保存下来，可以使用 `--save`：

```bash
cw worker interview --worker qwen-local --save
```

保存后的 profile 会写入 SQLite 工作区存储：

```text
~/.code-worker/<workspace-id>/data.db#worker_profiles
```

你可以通过下面的命令查看这些已保存的 profile：

```bash
cw worker list
cw worker profile qwen-local
```

当前行为仍然偏保守：如果 workflow 启动时没有显式传入 profile object，系统可以重新执行 interview，而不是盲目信任旧的能力记录。

## Worker registry 流程

先注册可复用 worker，再做 interview，并在真正执行时显式引用它：

```bash
cw worker register \
  --worker qwen-local \
  --provider litellm \
  --model qwen3-coder \
  --base-url http://localhost:4000/v1 \
  --allow-write

cw worker interview --worker qwen-local --save

cw task start \
  --goal "Review this repository" \
  --worker qwen-local \
  --require-profile

cw audit list
```

这条链路强调本地注册、能力画像持久化，以及可审计的显式分配，同时把整体任务控制权留在宿主手里。

## 仓库 review 流程

日常工程检查建议直接使用专用命令：

```bash
cw review repo --worker qwen-local --scope packages/graph
cw review diff --worker qwen-local --base main --head HEAD
cw review files --worker qwen-local --file packages/graph/src/index.ts
cw validate --all
cw validate --all --stop-on-failure --execute
cw fix error --worker qwen-local --error-log-file ./tmp/tsc-error.log --scope packages/core
```

这些命令会构建 repository context pack、安全读取 scope 内文件，并把确定性验证结果并入 review 输出。

## Patch 生命周期

patch 相关动作被明确拆成 proposal、inspection 和 gated apply 三步：

```bash
cw fix error --worker qwen-local --error-log-file ./tmp/tsc.log --scope packages/core

cw patch propose \
  --goal "Fix failing typecheck" \
  --scope packages/core \
  --worker qwen-local

cw patch inspect ./tmp/candidate.patch

cw patch apply ./tmp/candidate.patch --dry-run

cw patch apply ./tmp/candidate.patch \
  --allow-write \
  --confirm-apply \
  --typecheck \
  --lint \
  --test
```

这条生命周期的安全约束包括：

- 默认是 dry-run。
- 真正应用 patch 必须同时满足显式写入授权和显式确认。
- 不会自动创建 commit 或 PR。
- patch 相关动作会写入 audit event。
- apply 之后可以继续跑 validation，但本阶段不会自动回滚失败结果。

## Task session 流程

task session 默认会把本地可审查产物和可恢复状态写入 `~/.code-worker/<workspace-id>/data.db` 里的 SQLite 会话存储：

```bash
cw task start \
  --goal "Fix failing typecheck in packages/core" \
  --scope packages/core \
  --worker qwen-local \
  --require-profile \
  --typecheck \
  --lint \
  --propose-patch \
  --allow-write-session

cw task status <taskId>
cw task resume <taskId>
cw task report <taskId>
```

即使在 task resume 里，patch apply 仍然需要显式 gate：

```bash
cw task resume <taskId> \
  --apply-patch \
  --allow-write \
  --confirm-apply
```

`--allow-write-session` 只允许写入 CW session 产物，并不等于允许修改仓库文件。

## MCP server 用法

启动 stdio server：

```bash
cw mcp serve
```

打印通用的本地 MCP server 配置片段：

```bash
cw mcp config
```

列出当前暴露的工具名：

```bash
cw mcp list-tools
```

## 环境变量

参见 [.env.example](https://github.com/vndmea/mcp-code-worker/blob/master/.env.example)。

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`

## 配置优先级

运行时配置按以下顺序解析：

1. CLI flags
2. `~/.code-worker/<workspace-id>/config.json`
3. 内置默认值

`config.json` 应作为 worker、validation、安全策略和 MCP 相关运行时默认值的主配置面。provider API key 会持久化到用户级 SQLite 存储，本地 client command 则保留在 `config.json.workers[]`。请从目标仓库根目录启动 `cw`，不要再依赖环境变量覆盖 root/storage；真实密钥不应提交或写入日志。

用户级 CW `config.json` 里的 repository context 配置用于控制 review、fix、patch 和 task workflow 的默认 `ignoredPaths` 与 `strictFiles` 行为。

## 内置工作流

- `host-worker-workflow`：在宿主控制下执行单个 worker 任务，并带答案质量闸门
- `review-workflow`：汇总 diff 影响、风险、缺失测试与后续项
- `fix-error-workflow`：分析错误日志并给出以验证为导向的安全修复建议
- `patch-proposal-workflow`：生成并检查 patch proposal，但不直接改仓库
- `task-session-workflow`：执行端到端的 task session 持久化流程
- `worker-interview-workflow`：在生产路由前评估 worker 模型，并生成能力画像

## 运行基础示例

可通过 `pnpm exec tsx examples/host-worker-basic/src/index.ts` 查看当前的宿主管理示例流程。

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
3. 复用 core contracts 和宿主管理质量闸门。
4. 只有在补齐测试后，再通过 CLI 或 MCP 暴露出去。

## 如何添加新的 MCP tool

1. 在 `packages/mcp-server/src/tools` 下新增 tool definition。
2. 保持 handler 足够薄，把业务逻辑委托给 core workflow API。
3. 在 `packages/mcp-server/src/server.ts` 中注册。
4. 补充对应的注册测试。

## 如何配置 LiteLLM

将 LiteLLM 的非密钥 worker 配置持久化到 `config.json`，例如：

```json
{
  "version": 2,
  "workers": [
    {
      "workerId": "litellm-main",
      "provider": "litellm",
      "model": "<model>",
      "baseURL": "https://litellm.example.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

## 安全模型

- 默认模式是 dry-run。
- 文件写入需要显式的策略授权。
- Shell 执行通过 allowlist 控制。
- `git diff` 这类只读 git 检查命令即使在 dry-run 下也允许执行，因此 review workflow 不需要开启写权限。
- `cw init`、`cw cleanup`、worker registry 写入和 task session 持久化都只作用于 CW 本地存储。
- 仓库读取必须留在 repo root 内，并会阻止 `.env`、私钥等 secret-like 文件进入上下文。
- 专用 review / fix 流程只返回结构化 JSON，不会自动应用 patch。
- patch proposal / inspection / apply 被显式拆开，保证写入动作始终可审查。
- 如果结构化 patch 生成失败，fallback proposal 会被标记为不可应用的 `[PLACEHOLDER]` 产物。
- validation 命令统一走安全命令路径，相关行为可通过 audit log 追踪。
- `cw audit list` 可查看本地 workflow、文件与命令事件。
- `cw cleanup runs` 和 `cw cleanup audit` 只删除本地 CW 产物，不会碰项目源代码。
- 宿主驱动场景里，worker 输出在宿主接受前都不能视为最终结果。
- Worker 在进入生产任务前应先通过 onboarding evaluation。
- structured output 或可靠性不达标的 worker 会进入 `not-qualified` 状态；如果是环境或配置问题，则该 worker 在修复前应视为不可用。
- 密钥应持久化在用户级 SQLite 存储中，且绝不能写入日志。

## Dist smoke

在发布 CLI 相关改动前，建议同时运行两层 smoke：

```bash
pnpm smoke
pnpm smoke:dist
```

## Roadmap

- 扩展更多 workflow 覆盖和更丰富的确定性验证能力
- 后续增加领域专项编排包
- 增加 CI 自动化检查与发布能力
- 保持核心聚焦在 orchestration，而不是 UI
