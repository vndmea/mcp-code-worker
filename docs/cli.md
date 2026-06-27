# CLI

The CLI entrypoint is `ao`.

For the verified internal-trial install path, see `docs/install.md`.
For write gates and local artifact boundaries, see `docs/permissions.md`.

## Core Commands

```bash
ao setup
ao plan --goal "Generate TipTap nodes from S1000D proced.xsd"
ao run leader-worker-basic --goal "Generate tests for schema parser"
ao review repo --scope packages/graph
ao review diff --base main --head HEAD
ao review files --file packages/graph/src/index.ts
ao validate --typecheck --lint --test
ao fix error --error-log-file ./tmp/tsc-error.log --scope packages/schema-codegen
ao task start --goal "Fix failing typecheck" --scope packages/core --typecheck --error-log-file ./tmp/tsc-error.log --run-fix --allow-write-session
ao task report <taskId>
ao patch propose --goal "Fix failing typecheck" --scope packages/core
ao patch inspect ./tmp/candidate.patch
ao patch apply ./tmp/candidate.patch --dry-run
ao models list
ao worker interview --provider litellm --model qwen3-coder --save
ao worker benchmark --suite coding-v1 --worker litellm:qwen3-coder --save
ao worker benchmark --suite coding-v1 --worker litellm:qwen3-coder --save --update-profile-capabilities
ao worker list
ao worker profile litellm:qwen3-coder
ao audit list
ao cleanup runs
ao cleanup audit
ao doctor
ao mcp config
ao mcp config --root ${workspaceFolder}
ao mcp config --root ${workspaceFolder} --worker-client-command /path/to/compatible-client
ao mcp serve
ao mcp serve --root ${workspaceFolder}
ao mcp list-tools
```

For the current workspace-checkout install path, read every `ao ...` example in this document as `pnpm exec ao ...` from the repository root unless you have already linked or published the CLI separately.

Writes remain in dry-run mode unless a command explicitly enables repository writes with `--allow-write`.

`--allow-write-session` is narrower than `--allow-write`: it only permits local task artifacts under `aoStorageDir/runs`, not project file writes.

For MCP clients that launch `ao` outside the active repository, use `ao mcp serve --root <workspace-path>` or set `AO_ROOT_DIR` so tools resolve AO storage, git state, and repository files against the intended workspace.

For local client providers, `opencode` is the default command. Set `AO_WORKER_CLIENT_COMMAND` only when you need a different compatible CLI name or path.

## Review Commands

- `ao review repo` builds repository context for a scope and can run deterministic validation.
- `ao review diff` adds git diff context from `--base` and `--head`.
- `ao review files` constrains review to an explicit file list and still honors optional `--scope`.

## Fix And Patch Commands

- `ao fix error` analyzes an inline error log or `--error-log-file` and returns a structured fix plan.
- `ao patch propose` generates a reviewable patch proposal without applying changes.
- `ao patch propose --summary --max-bytes 4000` prints a smaller proposal summary while `--full` preserves the entire workflow payload.
- `ao patch inspect` is the safety gate for a stored proposal or raw diff import.
- `ao patch apply` requires both `--allow-write` and `--confirm-apply` before repository writes are permitted.

## Task Sessions

Task sessions keep local state under `~/.ao/workspaces/<workspace-id>/runs/<taskId>` by default:

```bash
ao task start \
  --goal "Fix failing typecheck in packages/core" \
  --scope packages/core \
  --worker litellm:qwen3-coder \
  --require-profile \
  --typecheck \
  --lint \
  --propose-patch \
  --inspect-patch \
  --allow-write-session

ao task status <taskId>
ao task report <taskId>
ao task report <taskId> --summary --max-bytes 2000
ao task resume <taskId> --apply-patch
ao task resume <taskId> --apply-patch --allow-write --confirm-apply
```

- `ao task report` is the primary human-readable artifact.
- `ao task resume` should follow the `nextRecommendedActions` returned by task start/resume.
- `ao setup` and `ao doctor` are the quickest readiness checks before you start a new task.
- `patch apply` stays explicitly gated even inside task sessions.
- `task start`, `task status`, `task resume`, `task list`, `review`, `fix`, and `validate` accept summary-oriented flags such as `--summary` and `--max-bytes`.

## Worker Evaluation

- `ao worker interview --save` is the onboarding step. It creates the persisted worker profile used for routing and safety gating.
- `ao worker benchmark --suite coding-v1 --save` measures coding-oriented behavior separately from onboarding.
- `--update-profile-capabilities` is the explicit capability reconciliation switch. It updates persisted `supportedTaskTypes` and `routingPolicy.allowPatchGeneration` only when the benchmark qualifies the worker for `patch-generation`.
- Run `ao worker interview --save` before trying to update profile capabilities from benchmark results.
- Benchmark results alone do not bypass patch inspection, dry-run apply, `allowWrite`, or `confirmApply`.
- If interview output contains provider invocation failures, `--save` is skipped on purpose and the command returns re-interview guidance instead of persisting a misleading blocked profile.

Benchmark artifacts are persisted under:

```text
~/.ao/workspaces/<workspace-id>/worker-benchmarks/<sanitized-worker-id>/coding-v1.json
```

The persisted directory name uses a filesystem-safe worker id. Example:
`openai-compatible:deepseek-v4-flash` becomes `openai-compatible_deepseek-v4-flash`.

## DeepSeek / OpenAI-Compatible Notes

Do not commit raw API keys into `config.json` or repository files. Provide worker secrets through `WORKER_MODEL_API_KEY`.

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
