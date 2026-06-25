# agent-orchestrator

English | [简体中文](https://github.com/vndmea/agent-orchestrator/blob/master/README.zh-CN.md)

`agent-orchestrator` is a TypeScript orchestration server for multi-model engineering workflows. It is designed for leader-worker execution, deterministic validation, and thin delivery layers through a CLI and MCP server.

## What this is

- A TypeScript/Node.js monorepo for orchestrating leader and worker agents
- A CLI callable by humans or other coding agents through shell commands
- An MCP server exposing orchestration capabilities as structured tools
- A safe workflow engine that defaults to dry-run behavior

## What this is not

- Not a Codex, OpenCode, Cursor, or Claude Code clone
- Not an interactive coding terminal or TUI
- Not a full chat interface
- Not a web UI product

## Architecture diagram

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

## Monorepo layout

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

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
```

## CLI usage

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

## Worker onboarding

Workers are not treated as automatically qualified just because a model endpoint exists.

Use onboarding evaluation before assigning real work:

```bash
ao worker interview --provider litellm --model qwen3-coder
ao worker interview --provider litellm --model qwen3-coder --save
ao worker list
ao worker profile litellm:qwen3-coder
```

The interview workflow evaluates:

- instruction following
- structured JSON output
- summarization
- code understanding
- simple TypeScript code generation
- confidence calibration

Interview results produce a `WorkerCapabilityProfile` that affects routing:

- `active`: worker can receive the task types it qualified for
- `limited`: worker is restricted to low-risk tasks and requires leader review
- `blocked`: worker is excluded from production workflows and emits warnings

Example warning output:

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

If the worker is significantly worse, the profile becomes `blocked` and production routing should treat it as unavailable.

### Persisting worker profiles

Use `--save` if you want to persist the interview result:

```bash
ao worker interview --provider litellm --model qwen3-coder --save
```

Saved profiles are written to:

```text
.ao/worker-profiles.json
```

You can inspect persisted profiles with:

```bash
ao worker list
ao worker profile litellm:qwen3-coder
```

Current behavior is conservative: if a workflow is started without an explicit profile object, the system can re-run the interview instead of blindly trusting an old capability record.

## Worker registry flow

Register a reusable worker, evaluate it, and keep the assignment explicit:

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

This flow keeps worker selection local, auditable, and gated by a persisted capability profile.

## Repository review flow

Use the dedicated repository workflows for day-to-day engineering checks:

```bash
ao review repo --scope packages/graph
ao review diff --base main --head HEAD
ao review files --file packages/graph/src/index.ts
ao validate --typecheck --lint --test
ao fix error --error-log-file ./tmp/tsc-error.log --scope packages/core
```

These commands build repository context packs, read scoped files safely, and route deterministic validation into the review output.

## MCP server usage

Start the stdio server:

```bash
ao mcp serve
```

List exposed tool names:

```bash
ao mcp list-tools
```

## Environment variables

See [.env.example](https://github.com/vndmea/agent-orchestrator/blob/master/.env.example).

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

## Workflows

- `planning-workflow`: builds a plan, worker assignment proposal, risk list, and validation strategy
- `leader-worker-workflow`: coordinates leader planning, worker execution, tool validation, and final review
- `review-workflow`: summarizes diff impact, risks, missing tests, and follow-up items
- `fix-error-workflow`: analyzes error logs and proposes safe validation-oriented fix steps
- `worker-interview-workflow`: evaluates a worker model before production routing and generates a capability profile

## How to run the basic example

```bash
pnpm example:leader-worker-basic
```

## How to add a new worker

1. Add a worker class under `packages/graph/src/workers`.
2. Give it a clear `WorkerCapability` with Zod-backed schemas.
3. Declare the worker's supported task types so routing can enforce capability limits.
4. Route it from a workflow and keep its output reviewable.
5. Make sure onboarding interview results can constrain how it is assigned.
6. Add tests for the workflow path it affects.

## How to add a new workflow

1. Create a workflow file under `packages/graph/src/workflows`.
2. Use LangGraph.js to model transitions explicitly.
3. Reuse core contracts and leader review patterns.
4. Expose it through the CLI or MCP only after tests exist.

## How to add a new MCP tool

1. Add a tool definition in `packages/mcp-server/src/tools`.
2. Keep the handler thin and delegate to core workflow APIs.
3. Register it in `packages/mcp-server/src/server.ts`.
4. Add a registration test.

## How to configure LiteLLM

Set `LEADER_MODEL_PROVIDER=litellm` or `WORKER_MODEL_PROVIDER=litellm`, then provide:

- `LITELLM_BASE_URL`
- `LITELLM_API_KEY`

If you want different endpoints for leader and worker traffic, use the model-specific base URL variables instead.

## Safety model

- Default mode is dry-run.
- File writes require explicit policy allowance.
- Shell execution is allowlisted.
- Repository reads stay inside the repo root and block secret-like files such as `.env` and private keys.
- Dedicated review and fix flows return structured JSON and do not apply patches.
- Validation commands go through the safe command path and can be inspected through audit logs.
- `ao audit list` exposes the local audit trail for workflow, file, and command events.
- Worker outputs are not final until leader review completes.
- Workers must pass onboarding evaluation before they should receive production tasks.
- Workers that fail structured output or reliability checks are limited or blocked.
- Secrets are expected from environment variables and should never be logged.

## Roadmap

- Expand workflow coverage and richer deterministic validations
- Add domain-specific orchestration packages later
- Add CI automation for checks and releases
- Keep the core focused on orchestration rather than UI
