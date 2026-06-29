# Trial Runbook

Use this runbook to execute one complete internal trial on a fresh machine.

Supporting templates:

- Trial evidence template: `docs/examples/internal-trial-evidence-template.md`
- RC checklist: `docs/internal-trial-rc-matrix.md`
- Branch protection / required checks: `docs/repository-governance.md`
- Install path: `docs/install.md`
- Permission model: `docs/permissions.md`

## Prerequisites

- Node.js `22`
- pnpm `>=11`
- Git available on `PATH`
- Optional real worker credentials persisted in the user-scoped `config.json`

CI currently validates Node 22. Other Node.js `>=22` versions are best-effort until they are added to the CI matrix.

## Local Quality Gate

```bash
pnpm install
pnpm build
pnpm exec cw doctor
pnpm smoke
pnpm smoke:dist
pnpm typecheck
pnpm lint
pnpm test
```

## Local Setup

```bash
pnpm exec cw init
pnpm exec cw doctor
```

Recommended next checks:

- Confirm `~/.cw/workspaces/<workspace-id>/config.json` exists.
- Confirm `worker-profiles.json` and `workers.json` were created in user-scoped CW storage, not in the repository checkout.
- If an API key was written into the user-scoped `config.json`, confirm it remains local-only and is not copied into commits, logs, or shared notes.
- Confirm no workflow depends on a repository-local legacy `.cw/` directory. Current builds do not read it.

## Write Modes And Safety Gates

- Dry-run: default for commands that could affect repository state or local managed artifacts.
- `--allow-write-session`: allows `cwStorageDir/runs/<taskId>` artifact persistence only.
- `--allow-write`: allows repository writes when the command supports them.
- `--confirm-apply`: the second explicit gate for patch application. `--allow-write` alone is not enough.

Dry-run does not create audit files by default for ordinary evaluation paths. Audit artifacts are local `cwStorageDir/audit` writes.

Patch apply remains two-step:

1. proposal and inspection
2. explicit apply with `--allow-write --confirm-apply`

## Worker Onboarding

Interview and benchmark serve different purposes:

- `interview`: onboarding trust, structured output, routing safety, baseline capability profile.
- `benchmark`: coding qualification, benchmark artifact, and explicit `patch-generation` promotion path.

`patch-generation` should only be enabled after:

1. `cw worker interview --worker <workerId> --save`
2. `cw worker benchmark --suite coding-v1 --worker <workerId> --save`
3. explicit `--update-profile-capabilities`

## Example: DeepSeek / OpenAI-Compatible Worker

Detailed provider expectations and troubleshooting are documented in `docs/provider-contracts/deepseek.md`.

Official OpenAI-compatible base URL currently documented by DeepSeek:

- `https://api.deepseek.com`

Compatibility path worth testing in some SDKs:

- `https://api.deepseek.com/v1`

```json
{
  "version": 1,
  "workerModel": {
    "apiKey": "<secret>"
  }
}
```

```powershell
cw worker register `
  --worker deepseek-flash `
  --provider openai-compatible `
  --model deepseek-v4-flash `
  --base-url https://api.deepseek.com `
  --allow-write

cw worker interview `
  --worker deepseek-flash `
  --save

cw worker benchmark `
  --suite coding-v1 `
  --worker deepseek-flash `
  --save `
  --update-profile-capabilities
```

DeepSeek troubleshooting:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "https://api.deepseek.com/models" `
  -Headers @{ Authorization = "Bearer <api-key>" }
```

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Return JSON: {\"ok\":true}"}]
  }'
```

If you get `Not Found`, test both base URLs, verify the model name, and confirm that `workerModel.apiKey` is persisted in `config.json`.

If interview output reports provider invocation failures, do not treat the resulting unavailable status as a completed onboarding result. `cw worker interview --worker <workerId> --save` now skips persistence in that case and returns recovery actions instead.

## Example: LiteLLM / Local Worker

```bash
cw worker register \
  --worker qwen-local \
  --provider litellm \
  --model qwen3-coder \
  --base-url http://localhost:4000/v1 \
  --allow-write

cw worker interview --worker qwen-local --save
cw worker benchmark --suite coding-v1 --worker qwen-local --save --update-profile-capabilities
```

## End-To-End Task Session

```bash
cw task start \
  --goal "Review packages/core and propose safe improvements" \
  --scope packages/core \
  --worker deepseek-flash \
  --require-profile \
  --typecheck \
  --propose-patch \
  --inspect-patch \
  --allow-write-session
```

After `cw task start`, capture the returned `taskId`, then:

```bash
cw task report <taskId>
cw audit list
```

For MCP clients, use `cw_get_task_report` and `cw_read_task_artifact` against the returned artifact refs instead of rehydrating large task payloads eagerly.

If onboarding is driven from an MCP client rather than the CLI, use `cw_run_worker_interview` first and then `cw_benchmark_worker` so benchmark evidence and optional capability promotion stay inside the same reviewed tool surface.

If a patch proposal was generated and inspection passed:

```bash
cw task resume <taskId> --apply-patch
cw task resume <taskId> --apply-patch --allow-write --confirm-apply
```

## Evidence To Keep

For each internal trial run, keep:

- commit SHA
- `cw` package version
- worker id, provider, model, base URL
- interview/profile artifact path
- benchmark artifact path
- task session id
- `cwStorageDir/runs/<taskId>/report.md`
- patch proposal / inspection artifact paths
- sanitized failure reason if the run failed
- any returned re-interview guidance when provider invocation failed

Do not keep:

- raw API keys
- bearer tokens
- full sensitive request headers
- raw operator usernames or machine-specific absolute paths when a sanitized placeholder such as `<workspace-root>` or `%USERPROFILE%\.cw` is enough

## Rollback Notes

- Task session artifacts can be removed with `cw cleanup runs`.
- Audit artifacts can be removed with `cw cleanup audit`.
- Repository changes are never auto-committed.
- Patch apply validation failures should be handled through the recorded recovery guidance in the task report.
