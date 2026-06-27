# DeepSeek Internal Trial Evidence

## Run Identity

- Date: 2026-06-26
- Operator: local operator
- Commit SHA: `0708ae170951f8fb9c781b847beec70473168696`
- Runtime trial target: `0708ae170951f8fb9c781b847beec70473168696`
- `cw` package version: `0.1.0`
- Node: `v22.22.0`
- pnpm: `11.9.0`
- Workspace root: `<workspace-root>`
- CW home override: `%USERPROFILE%\.cw-rc-20260626`
- Distribution path: repository checkout plus built CLI (`node packages/cli/dist/main.js`) and built MCP exports (`packages/mcp-server/dist/index.js`)
- Note: later documentation-only commits may differ from the runtime trial target above without changing the validated runtime result.

## Local Quality Gate

The following commands completed successfully on the commit above:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm smoke`
- `pnpm smoke:dist`

## Worker: `openai-compatible:deepseek-v4-flash`

### Registration

- Provider: `openai-compatible`
- Model: `deepseek-v4-flash`
- Base URL: `https://api.deepseek.com`
- API key env var: `WORKER_MODEL_API_KEY`
- Worker registry path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\workers.json`

### Interview

- Command: `node packages/cli/dist/main.js worker interview --worker openai-compatible:deepseek-v4-flash --save`
- Result: passed
- `providerInvocationFailures`: `0`
- Profile status: `active`
- Persistence mode: `execute`
- Profile path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\worker-profiles.json`

### Benchmark

- Command: `node packages/cli/dist/main.js worker benchmark --suite coding-v1 --worker openai-compatible:deepseek-v4-flash --save --update-profile-capabilities`
- Result: passed
- Passed samples: `4/4`
- Confidence band: `high`
- Capability update applied: `true`
- `patch-generation` qualified: `true`
- Benchmark artifact path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\worker-benchmarks\openai-compatible_deepseek-v4-flash\coding-v1.json`

### Safety Gate Check

- Task id used for patch-apply gate verification: `task-2026-06-26T15-10-12-869Z-e4b2538c`
- CLI summary output: verified with `cw task report <taskId> --summary`
- MCP summary/full output: verified with `cw_get_task_report`
- MCP artifact read: verified with `cw_read_task_artifact` for `report.md`
- Patch apply gate result: blocked as expected on dirty worktree
- Blocking reason: `Dirty worktree detected. Re-run with --allow-dirty-worktree only after reviewing local changes.`
- Patch apply artifact path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-12-869Z-e4b2538c\patch-apply-result.json`

## Worker: `openai-compatible:deepseek-v4-pro`

### Registration

- Provider: `openai-compatible`
- Model: `deepseek-v4-pro`
- Base URL: `https://api.deepseek.com`
- API key env var: `WORKER_MODEL_API_KEY`
- Worker registry path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\workers.json`

### Interview

- Command: `node packages/cli/dist/main.js worker interview --worker openai-compatible:deepseek-v4-pro --save`
- Result: passed
- `providerInvocationFailures`: `0`
- Profile status: `active`
- Persistence mode: `execute`
- Profile path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\worker-profiles.json`

### Benchmark

- Command: `node packages/cli/dist/main.js worker benchmark --suite coding-v1 --worker openai-compatible:deepseek-v4-pro --save --update-profile-capabilities`
- Result: passed
- Passed samples: `4/4`
- Confidence band: `high`
- Capability update applied: `true`
- `patch-generation` qualified: `true`
- Benchmark artifact path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\worker-benchmarks\openai-compatible_deepseek-v4-pro\coding-v1.json`

### Persisted Task Session Check

- Command: `node packages/cli/dist/main.js task start --goal "Review packages/core and propose safe improvements" --scope packages/core --worker openai-compatible:deepseek-v4-pro --require-profile --typecheck --propose-patch --inspect-patch --allow-write-session`
- Task id: `task-2026-06-26T15-10-13-113Z-2881390f`
- Session persisted: `yes`
- Artifact registry complete: `yes`
- Session path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-13-113Z-2881390f\session.json`
- Report path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-13-113Z-2881390f\report.md`
- Validation artifact path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-13-113Z-2881390f\validation-report.json`
- Patch proposal path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-13-113Z-2881390f\patch-proposal.json`
- Patch inspection path: `%USERPROFILE%\.cw-rc-20260626\workspaces\mcp-code-worker-645b92a8a0\runs\task-2026-06-26T15-10-13-113Z-2881390f\patch-inspection.json`
- Artifact names verified: `repository-context.json`, `review-result.json`, `validation-report.json`, `patch-proposal.json`, `patch-inspection.json`, `report.md`

### CLI / MCP Output Checks

- CLI summary output: verified with `cw task report <taskId> --summary`
- MCP summary output: verified with `cw_get_task_report(detailLevel="summary")`
- MCP full output: verified with `cw_get_task_report(detailLevel="full")`
- MCP artifact read: verified with `cw_read_task_artifact` for `report.md`

### Validation Note

- The sample task returned a validation warning instead of a clean pass because `packages/core` does not define a `typecheck` script.
- Report wording was explicit: validation could not run because `typecheck` is not configured.

## Provider Robustness Coverage

- Automated coverage exists for provider-failure handling in `packages/graph/src/workflows/worker-interview-workflow.test.ts`.
- Resolution behavior is also covered in `packages/models/src/router/worker-profile-resolution.test.ts` and `packages/models/src/router/worker-profile-doctor.test.ts`.
- These tests were included in the successful `pnpm test` run on 2026-06-26.

## Safety Notes

- No API key was committed.
- No bearer token was committed.
- CW artifacts stayed under user-scoped CW storage, not the repository checkout.
- No repository-local legacy `.cw` directory was required.
- The shell environment emitted a Node warning about `NODE_TLS_REJECT_UNAUTHORIZED=0`. This was inherited from the operator environment, not set by CW, and should be cleared before any shared team trial.

## Decision

- Trial result: pass
- Sanitized failure reason: none for onboarding and benchmark; patch apply was intentionally blocked by the dirty-worktree safety gate during verification
- Re-interview guidance returned: not needed
- Rollback or cleanup actions taken: none
- Follow-up owner: local operator
- Follow-up due date: before shared team trial, remove insecure TLS override from the shell environment
