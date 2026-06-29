# CLI

The CLI entrypoint is `cw`.

For the public install path, see `docs/install.md`.
For write gates and local artifact boundaries, see `docs/permissions.md`.

## Core Commands

```bash
cw init
cw init --preset mock --allow-write
cw init --preset deepseek --allow-write
cw init --preset opencode --allow-write
cw review repo --scope packages/graph
cw review diff --base main --head HEAD
cw review files --file packages/graph/src/index.ts
cw validate --all
cw validate --all --stop-on-failure --execute
cw fix error --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
cw task start --goal "Fix failing typecheck" --scope packages/core --worker qwen-local --typecheck --error-log-file ./tmp/tsc-error.log --run-fix --allow-write-session
cw task report <taskId>
cw patch propose --goal "Fix failing typecheck" --scope packages/core --worker qwen-local
cw patch inspect ./tmp/candidate.patch
cw patch apply ./tmp/candidate.patch --dry-run
cw models list
cw worker register --worker qwen-local --provider litellm --model qwen3-coder --base-url http://localhost:4000/v1 --allow-write
cw worker interview --worker qwen-local --save
cw worker readiness --worker qwen-local
cw worker benchmark --suite coding-v1 --worker qwen-local --save
cw worker benchmark --suite coding-v1 --worker qwen-local --save --update-profile-capabilities
cw worker list
cw worker profile qwen-local
cw audit list
cw cleanup runs
cw cleanup audit
cw doctor
cw doctor --probe
cw doctor --mcp
cw doctor --mcp --host codex
cw mcp config
cw mcp serve
cw mcp list-tools
```

Read every `cw ...` example in this document as the public npm-installed CLI unless noted otherwise. For a workspace checkout, run the same commands as `pnpm exec cw ...` from the repository root.

Writes remain in dry-run mode unless a command explicitly enables repository writes with `--allow-write`.

`--allow-write-session` is narrower than `--allow-write`: it only permits local task artifacts under `cwStorageDir/runs`, not project file writes.

For MCP clients, `cw mcp serve` does not take `--root`. Launch it from the intended repository root by default, or set `CW_WORKSPACE_DIR` when the client starts `cw` from some other directory.

Treat `config.json` as the primary runtime config surface for worker, validation, safety, and local client defaults. Treat the MCP host snippet as launch-only: command, args, and optionally `CW_WORKSPACE_DIR` / `CW_STORAGE_DIR`.

For local client providers, `opencode` is the default command. Start with `cw init --preset opencode --allow-write`, then persist a different compatible CLI name or path in `config.json` through `cw init --worker-client-command <command> --allow-write` or a manual edit when needed.

`cw init` prints the resolved CW storage paths, including the user-scoped config file at `~/.cw/workspaces/<workspace-id>/config.json`, and can open that directory for you at the end of onboarding.

For instruction scoping, put repository-specific guidance in `./AGENTS.md` and global Codex defaults in `~/.codex/AGENTS.md`.

## Review Commands

- `cw review repo` builds repository context for a scope and can run deterministic validation.
- `cw review diff` adds git diff context from `--base` and `--head`.
- `cw review files` constrains review to an explicit file list and still honors optional `--scope`.

## Fix And Patch Commands

- `cw fix error` analyzes an inline error log or `--error-log-file` and returns a structured fix plan.
- `cw patch propose` generates a reviewable patch proposal without applying changes and now requires an explicit `--worker`.
- `cw patch propose --summary --max-bytes 4000` prints a smaller proposal summary while `--full` preserves the entire workflow payload.
- `cw patch inspect` is the safety gate for a stored proposal or raw diff import.
- `cw patch apply` requires both `--allow-write` and `--confirm-apply` before repository writes are permitted.

## Task Sessions

Task sessions keep local state under `~/.cw/workspaces/<workspace-id>/runs/<taskId>` by default:

```bash
cw task start \
  --goal "Fix failing typecheck in packages/core" \
  --scope packages/core \
  --worker qwen-local \
  --require-profile \
  --typecheck \
  --lint \
  --propose-patch \
  --inspect-patch \
  --allow-write-session

cw task status <taskId>
cw task report <taskId>
cw task report <taskId> --summary --max-bytes 2000
cw task resume <taskId> --apply-patch
cw task resume <taskId> --apply-patch --allow-write --confirm-apply
```

- `cw task report` is the primary human-readable artifact.
- `cw task resume` should follow the `nextRecommendedActions` returned by task start/resume.
- `cw task start` requires an explicit named worker via `--worker <workerId>`.
- `cw init` and `cw doctor` verify setup, while `cw worker readiness` gives the single task-readiness answer for one worker.
- `cw doctor --mcp` adds host-level MCP checks for config presence, snippet validity, launchability, live stdio connectivity, and tool-list matching.
- `patch apply` stays explicitly gated even inside task sessions.
- `task start`, `task status`, `task resume`, `task list`, `review`, `fix`, and `validate` accept summary-oriented flags such as `--summary` and `--max-bytes`.

## Worker Evaluation

- `cw init` is the default onboarding path; `cw worker register` and `cw worker interview --save` remain the explicit advanced flow.
- `cw worker readiness --worker <workerId>` is the single answer for "can this worker run formal tasks right now?"
- `cw worker benchmark --suite coding-v1 --save` measures coding-oriented behavior separately from onboarding.
- `--update-profile-capabilities` is the explicit capability reconciliation switch. It updates persisted `supportedTaskTypes` and `routingPolicy.allowPatchGeneration` only when the benchmark qualifies the worker for `patch-generation`.
- Run `cw worker interview --save` before trying to update profile capabilities from benchmark results.
- Run `cw worker readiness --worker <workerId> --probe` when you want the readiness answer to include a live connectivity check instead of only persisted evidence.
- Benchmark results alone do not bypass patch inspection, dry-run apply, `allowWrite`, or `confirmApply`.
- If interview output contains provider invocation failures, `--save` is skipped on purpose and the command returns re-interview guidance instead of persisting a misleading non-qualification result.

Benchmark artifacts are persisted under:

```text
~/.cw/workspaces/<workspace-id>/worker-benchmarks/<sanitized-worker-id>/coding-v1.json
```

The persisted directory name uses a filesystem-safe worker id. Example:
`deepseek/flash-prod` becomes `deepseek_flash-prod`.

## DeepSeek / OpenAI-Compatible Notes

You can persist worker API keys in the user-scoped CW `config.json` or provide them through `WORKER_MODEL_API_KEY`. Never commit real keys into repository files or include them in logs.

For DeepSeek-compatible workers:

- Official OpenAI-compatible base URL: `https://api.deepseek.com`
- Compatibility path worth testing if a client or SDK expects it: `https://api.deepseek.com/v1`

Suggested troubleshooting flow:

```powershell
$env:WORKER_MODEL_API_KEY="..."

Invoke-RestMethod `
  -Method Get `
  -Uri "https://api.deepseek.com/models" `
  -Headers @{ Authorization = "Bearer $env:WORKER_MODEL_API_KEY" }
```

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $WORKER_MODEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Return JSON: {\"ok\":true}"}]
  }'
```

If `Not Found` occurs, test both `https://api.deepseek.com` and `https://api.deepseek.com/v1` and confirm the model name, network access, and `WORKER_MODEL_API_KEY` runtime wiring.
