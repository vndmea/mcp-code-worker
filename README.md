# mcp-code-worker

[English](https://github.com/vndmea/mcp-code-worker/blob/master/README.md) | [简体中文](https://github.com/vndmea/mcp-code-worker/blob/master/README.zh-CN.md)

`mcp-code-worker` is a TypeScript orchestration runtime for multi-model engineering workflows. It is designed to keep worker execution, repository context selection, deterministic validation, and local task artifacts under explicit control through a CLI and MCP server.

## What this is

- A TypeScript/Node.js monorepo for orchestrating worker execution, validation, and task artifacts
- A CLI callable by humans or other coding agents through shell commands
- An MCP server exposing orchestration capabilities as structured tools
- A safe workflow engine that defaults to dry-run behavior
- A local execution layer that keeps repository reads, patch lifecycle, and worker qualification auditable

## What this is not

- Not a Codex, OpenCode, Cursor, or Claude Code clone
- Not an interactive coding terminal or TUI
- Not a full chat interface
- Not a web UI product

## Host relationship

In host-driven use cases such as Codex, `cw` stays as the controlled execution/runtime layer.

- The host agent stays responsible for user intent, final judgment, and acceptance.
- `cw` provides the controlled runtime: worker routing, repository context packs, deterministic validation, artifact persistence, and patch gates.
- The recommended host-facing path is `cw_start_task` and other host-managed tools.
- For narrow repo-grounded checks, prefer explicit file lists with strict file mode so CW fails fast instead of silently widening or skipping critical evidence.

## Architecture diagram

```text
Human / Coding Agent / CI / MCP Client
                |
                v
           cw CLI / MCP
                |
                v
   Orchestration Runtime Layer
      |            |         \
      v            v          v
 Worker Routing  Deterministic Tools  CW Storage / Artifacts
      |
      v
 Worker Models / Local Clients
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
  host-worker-basic/
docs/
```

## Runtime requirements

- Node.js `22`
- pnpm `>=10`

This repository targets actively maintained Node.js LTS releases only. CI currently validates Node 22. Other Node.js `>=22` versions are best-effort until they are added to the CI matrix.

See [docs/supported-matrix.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/supported-matrix.md) for the explicit OS, Node.js, and MCP host support boundary.

## Install

Global npm install:

```bash
npm i -g mcp-code-worker
cw init
cw doctor
cw mcp list-tools
```

Development checkout:

```bash
node --version
pnpm install
pnpm build
pnpm exec cw doctor
pnpm exec cw init
pnpm exec cw doctor
pnpm typecheck
pnpm test
```

## First run

```bash
cw init
cw doctor --probe
cw mcp config
```

Use `cw init` as the onboarding path. Run it interactively by default, or use presets such as `cw init --preset mock --allow-write`, `cw init --preset deepseek --allow-write`, or `cw init --preset opencode --allow-write` when you want a faster scripted path before tweaking lower-level details.

Public installation and MCP launch guidance lives in [docs/install.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/install.md).
The current official internal distribution shape is documented in [docs/distribution.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/distribution.md).

Unless noted otherwise, read every `cw ...` example below as the public npm-installed CLI. In a repository checkout, use `pnpm exec cw ...` from the repository root instead.

Legacy repository-local `.cw/` directories are unsupported and ignored by current builds.

`cw init` writes user-scoped CW workspace storage under `~/.cw/workspaces/<workspace-id>/` by default:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `audit/`
- `runs/`

## CLI usage

```bash
cw review repo --worker qwen-local --scope packages/graph
cw review diff --worker qwen-local --base main --head HEAD
cw review files --worker qwen-local --file packages/graph/src/index.ts --strict-files
cw validate --all
cw validate --all --stop-on-failure --execute
cw fix error --worker qwen-local --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
cw task start --goal "Fix failing typecheck" --scope packages/core --typecheck --error-log-file ./tmp/tsc-error.log --run-fix --allow-write-session
cw task report <taskId>
cw cleanup runs
cw cleanup audit
cw models list
cw mcp config
cw mcp serve
cw mcp list-tools
```

`cw review files --strict-files` and `cw_run_host_worker` now expose debug evidence for host-managed worker runs, including requested files, selected files, worker metadata, and structured-output failure details.

## Worker onboarding

Workers are not treated as automatically qualified just because a model endpoint exists.

> Warning:
> A weaker worker model does not automatically save tokens. If the host still has to verify, rewrite, or redo most of the output, the total token cost can increase rather than decrease.
> Token savings are more likely when the delegated task is narrow, mechanical, low-risk, and easy to verify, such as running checks, extracting fields, collecting logs, or summarizing a very small scoped input.

Use `cw init` as the default onboarding path. For explicit advanced flows, register a named worker and then evaluate it before assigning real work:

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

The interview workflow evaluates:

- instruction following
- structured JSON output
- strict scope discipline
- summarization
- evidence-linked repository review
- refusal when mandatory evidence is missing
- code understanding
- simple TypeScript code generation
- confidence calibration

Interview results produce a `WorkerCapabilityProfile` that affects routing:

- `qualified`: worker can receive the task types it qualified for
- `not-qualified`: worker completed evaluation but stays restricted from qualified task types

Example warning output:

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

If the worker cannot complete evaluation because of configuration or connectivity problems, the interview result is not persisted and production routing should treat the worker as unavailable until the runtime issue is fixed.

### Persisting worker profiles

Use `--save` if you want to persist the interview result:

```bash
cw worker interview --worker qwen-local --save
```

Saved profiles are written to:

```text
~/.cw/workspaces/<workspace-id>/worker-profiles.json
```

You can inspect persisted profiles with:

```bash
cw worker list
cw worker profile qwen-local
```

Current behavior is conservative: if a workflow is started without an explicit profile object, the system can re-run the interview instead of blindly trusting an old capability record.

## Worker registry flow

Register a reusable worker, evaluate it, and keep the assignment explicit:

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

This flow keeps worker selection local, auditable, and gated by a persisted capability profile while leaving the host in control of the overall task.

## Repository review flow

Use the dedicated repository workflows for day-to-day engineering checks:

```bash
cw review repo --worker qwen-local --scope packages/graph
cw review diff --worker qwen-local --base main --head HEAD
cw review files --worker qwen-local --file packages/graph/src/index.ts
cw validate --all
cw validate --all --stop-on-failure --execute
cw fix error --worker qwen-local --error-log-file ./tmp/tsc-error.log --scope packages/core
```

These commands build repository context packs, read scoped files safely, and route deterministic validation into the review output.

## Patch lifecycle

Patch handling is intentionally separated into proposal, inspection, and gated apply steps:

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

Safety constraints for patch lifecycle:

- Dry-run is the default.
- Applying a patch requires both an explicit write gate and an explicit confirmation gate.
- No command creates commits or PRs automatically.
- Patch actions emit audit events.
- Validation can run after apply, but failed validation does not auto-revert in this iteration.

## Task sessions

Task sessions keep local review artifacts and resumable state under `~/.cw/workspaces/<workspace-id>/runs` by default:

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

Patch apply is still a separate explicit gate even inside task resume:

```bash
cw task resume <taskId> \
  --apply-patch \
  --allow-write \
  --confirm-apply
```

Session persistence is separate from repository writes. `--allow-write-session` only permits CW session artifacts under `runs/`. It does not enable patch apply.

See [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md) for the full write-gate model.

## MCP server usage

Start the stdio server:

```bash
cw mcp serve
```

Print a generic stdio config snippet for local MCP clients:

```bash
cw mcp config
```

List exposed tool names:

```bash
cw mcp list-tools
```

## Environment variables

See [.env.example](https://github.com/vndmea/mcp-code-worker/blob/master/.env.example).

- `WORKER_MODEL_PROVIDER`
- `WORKER_MODEL_NAME`
- `WORKER_MODEL_BASE_URL`
- `WORKER_MODEL_API_KEY`
- `LITELLM_BASE_URL`
- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`
- `CW_WORKSPACE_DIR`
- `CW_STORAGE_DIR`
- `CW_WORKER_CLIENT_COMMAND`
- `CW_DRY_RUN`
- `CW_ALLOW_WRITE`
- `CW_ALLOWED_COMMANDS`

## Config precedence

Runtime configuration resolves in this order:

1. CLI flags
2. `~/.cw/workspaces/<workspace-id>/config.json`
3. Environment variables
4. built-in defaults

Use `config.json` as the primary home for persisted worker, validation, safety, and MCP-adjacent runtime defaults, including provider API keys when you intentionally want one local config surface. Keep launch-location bootstrap values such as `CW_WORKSPACE_DIR` and `CW_STORAGE_DIR` in environment variables, and never commit real keys or include them in logs.

Repository context settings in the user-scoped CW `config.json` control default `ignoredPaths` and `strictFiles` behavior for review, fix, patch, and task workflows.

## Workflows

- `host-worker-workflow`: runs one explicit worker task under host control with answer-quality gates
- `review-workflow`: summarizes diff impact, risks, missing tests, and follow-up items
- `fix-error-workflow`: analyzes error logs and proposes safe validation-oriented fix steps
- `patch-proposal-workflow`: generates and inspects patch proposals without applying repository writes
- `task-session-workflow`: runs the end-to-end persisted task pipeline
- `worker-interview-workflow`: evaluates a worker model before production routing and generates a capability profile

## How to run the basic example

Run `pnpm exec tsx examples/host-worker-basic/src/index.ts` to inspect the host-managed example workflow.

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
3. Reuse core contracts and host-managed quality gates.
4. Expose it through the CLI or MCP only after tests exist.

## How to add a new MCP tool

1. Add a tool definition in `packages/mcp-server/src/tools`.
2. Keep the handler thin and delegate to core workflow APIs.
3. Register it in `packages/mcp-server/src/server.ts`.
4. Add a registration test.

## How to configure LiteLLM

Set `WORKER_MODEL_PROVIDER=litellm`, then provide:

- `LITELLM_BASE_URL`
  Use `WORKER_MODEL_BASE_URL` when worker traffic should target a non-default endpoint.

## Safety model

- Default mode is dry-run.
- File writes require explicit policy allowance.
- Shell execution is allowlisted.
- Read-only git inspection commands such as `git diff` can still execute inside dry-run so review workflows keep working without enabling writes.
- `cw init`, `cw cleanup`, worker registry writes, and task session persistence remain local-only inside CW-managed storage.
- Repository reads stay inside the repo root and block secret-like files such as `.env` and private keys.
- Dedicated review and fix flows return structured JSON and do not apply patches.
- Patch proposal, inspection, and apply are separated to keep write actions reviewable.
- If structured patch generation fails, the fallback proposal is marked as a blocked `[PLACEHOLDER]` artifact and cannot be applied.
- Validation commands go through the safe command path and can be inspected through audit logs.
- `cw audit list` exposes the local audit trail for workflow, file, and command events.
- `cw cleanup runs` and `cw cleanup audit` only delete local CW artifacts and never touch project source files.
- In host-driven flows, worker outputs are not final until the host accepts them.
- Workers must pass onboarding evaluation before they should receive production tasks.
- Workers that fail structured output or reliability checks become `not-qualified`. Environment or configuration failures keep the worker unavailable for formal tasks until the runtime issue is fixed.
- Secrets may come from environment variables or the user-scoped CW `config.json` and should never be logged.

See [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md) for the concrete permission layers and write-gate examples.

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
