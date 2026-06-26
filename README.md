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

## Runtime requirements

- Node.js `22`
- pnpm `>=10`

This repository targets actively maintained Node.js LTS releases only. CI currently validates Node 22. Other Node.js `>=22` versions are best-effort until they are added to the CI matrix.

## Setup

```bash
node --version
pnpm install
pnpm build
pnpm exec ao doctor
pnpm exec ao setup --allow-write
pnpm exec ao doctor
pnpm typecheck
pnpm test
```

## First run

```bash
pnpm exec ao setup --allow-write
pnpm exec ao doctor
pnpm exec ao mcp config
```

Internal-trial installation and MCP launch guidance lives in `docs/install.md`.

Unless noted otherwise, read every `ao ...` example below as `pnpm exec ao ...` from the repository root for the current internal-trial install path.

Legacy repository-local `.ao/` directories are unsupported and ignored by current builds.

`ao setup` creates user-scoped AO workspace storage under `~/.ao/workspaces/<workspace-id>/` by default:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `audit/`
- `runs/`

`ao init` remains available as a lower-level bootstrap command, but `ao setup` is the primary onboarding entrypoint.

## CLI usage

```bash
ao plan --goal "Generate TipTap nodes from S1000D proced.xsd"
ao run leader-worker-basic --goal "Generate tests for schema parser"
ao review repo --scope packages/graph
ao review diff --base main --head HEAD
ao review files --file packages/graph/src/index.ts
ao validate --typecheck --lint --test
ao fix error --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
ao task start --goal "Fix failing typecheck" --scope packages/core --typecheck --error-log-file ./tmp/tsc-error.log --run-fix --allow-write-session
ao task report <taskId>
ao cleanup runs
ao cleanup audit
ao models list
ao mcp config
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
~/.ao/workspaces/<workspace-id>/worker-profiles.json
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

## Patch lifecycle

Patch handling is intentionally separated into proposal, inspection, and gated apply steps:

```bash
ao fix error --error-log-file ./tmp/tsc.log --scope packages/core

ao patch propose \
  --goal "Fix failing typecheck" \
  --scope packages/core

ao patch inspect ./tmp/candidate.patch

ao patch apply ./tmp/candidate.patch --dry-run

ao patch apply ./tmp/candidate.patch \
  --allow-write \
  --confirm-apply \
  --typecheck \
  --lint \
  --test
```

Safety constraints for patch lifecycle:

- Dry-run is the default.
- Applying a patch requires both an explicit write gate and an explicit confirmation gate.
- No command creates commits or PRs automatically.
- Patch actions emit audit events.
- Validation can run after apply, but failed validation does not auto-revert in this iteration.

## Task sessions

Task sessions keep local review artifacts and resumable state under `~/.ao/workspaces/<workspace-id>/runs` by default:

```bash
ao task start \
  --goal "Fix failing typecheck in packages/core" \
  --scope packages/core \
  --worker litellm:qwen3-coder \
  --require-profile \
  --typecheck \
  --lint \
  --propose-patch \
  --allow-write-session

ao task status <taskId>
ao task resume <taskId>
ao task report <taskId>
```

Patch apply is still a separate explicit gate even inside task resume:

```bash
ao task resume <taskId> \
  --apply-patch \
  --allow-write \
  --confirm-apply
```

Session persistence is separate from repository writes. `--allow-write-session` only permits AO session artifacts under `runs/`. It does not enable patch apply.

See `docs/permissions.md` for the full write-gate model.

## MCP server usage

Start the stdio server:

```bash
ao mcp serve
```

Print a generic stdio config snippet for local MCP clients:

```bash
ao mcp config
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
- `AO_ROOT_DIR`
- `AO_HOME_DIR`
- `AO_DRY_RUN`
- `AO_ALLOW_WRITE`
- `AO_ALLOWED_COMMANDS`

## Config precedence

Runtime configuration resolves in this order:

1. CLI flags
2. Environment variables
3. `~/.ao/workspaces/<workspace-id>/config.json`
4. built-in defaults

`config.json` stores only env-var names for secrets such as `apiKeyEnvVar`. Actual API keys stay in the environment.

Repository context settings in the user-scoped AO `config.json` also control default `maxFileBytes`, `maxTotalBytes`, and `ignoredPaths` for review, fix, patch, and task workflows unless a command overrides them explicitly.

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
- Read-only git inspection commands such as `git diff` can still execute inside dry-run so review workflows keep working without enabling writes.
- `ao setup`, `ao init`, `ao cleanup`, worker registry writes, and task session persistence remain local-only inside AO-managed storage.
- Repository reads stay inside the repo root and block secret-like files such as `.env` and private keys.
- Dedicated review and fix flows return structured JSON and do not apply patches.
- Patch proposal, inspection, and apply are separated to keep write actions reviewable.
- If structured patch generation fails, the fallback proposal is marked as a blocked `[PLACEHOLDER]` artifact and cannot be applied.
- Validation commands go through the safe command path and can be inspected through audit logs.
- `ao audit list` exposes the local audit trail for workflow, file, and command events.
- `ao cleanup runs` and `ao cleanup audit` only delete local AO artifacts and never touch project source files.
- Worker outputs are not final until leader review completes.
- Workers must pass onboarding evaluation before they should receive production tasks.
- Workers that fail structured output or reliability checks are limited or blocked.
- Secrets are expected from environment variables and should never be logged.

See `docs/permissions.md` for the concrete permission layers and write-gate examples.

## Dist smoke

Use both smoke layers before shipping CLI changes:

```bash
pnpm smoke
pnpm smoke:dist
```

## Roadmap

- Expand workflow coverage and richer deterministic validations
- Add domain-specific orchestration packages later
- Add CI automation for checks and releases
- Keep the core focused on orchestration rather than UI
