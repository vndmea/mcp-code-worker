# Troubleshooting

Use this guide for the most common setup, runtime, MCP, and worker qualification issues in `mcp-code-worker`.

## Quick Checks First

Start every investigation with:

```bash
cw doctor
cw doctor --probe
cw doctor --mcp --host=codex
cw mcp list-tools
```

If you are using a repository checkout, run the commands as `pnpm exec cw ...` from the repository root.

## `cw` Command Not Found

### Symptoms

- `cw` is not recognized after installation
- global install completed but the command is missing

### Checks

- Confirm the public install path was used: `npm i -g mcp-code-worker`
- Confirm the active Node.js and npm environment is the one where the package was installed
- In a repository checkout, prefer `pnpm exec cw ...` from the repository root

## Wrong Repository Root Or Empty Context

### Symptoms

- MCP tools look at the wrong checkout
- review or task commands appear to ignore the intended repository

### Checks

- Start `cw mcp serve` from the intended workspace root
- Re-run `cw mcp config` after changing root assumptions
- Read the `root-dir` and `runtime-bootstrap` checks from `cw doctor` to confirm which root, config path, and CW home path are actually active

Different absolute repository roots produce different workspace ids, so a root mismatch can look like “missing” state when the real issue is path resolution.

## CW State Is Not Where You Expected

### Symptoms

- `workers.json`, `worker-profiles.json`, or `runs/` are not under the path you expected
- one checkout cannot see state created by another

### Checks

- Remember that default state lives under `~/.cw/workspaces/<workspace-id>/`
- Read the `runtime-bootstrap` check from `cw doctor` for the resolved `config.json`, `cwStorageDir`, `cwHomeDir`, and `workspaceId`

## Worker Interview Is Blocked By Provider Failures

### Symptoms

- `cw worker interview --worker=<workerId> --save` returns provider invocation failures
- the worker remains unavailable at readiness time for provider/configuration reasons

### Checks

- Confirm `workerModel.apiKey` is persisted in the active CW `config.json`
- Confirm the provider name, model name, and base URL are correct
- For DeepSeek-compatible workers, test both documented base URLs if needed
- Re-run the health checks in [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)

Do not treat a provider-failure interview as a completed onboarding result.

## Local Client Provider Cannot Launch

### Symptoms

- worker execution fails before the model call
- a local compatible client cannot be found

### Checks

- If you use the local client provider, remember that `opencode` is the default compatible command
- Prefer persisting `workerClientCommand` in `config.json` or via `cw init --worker-client-command=<command> --allow-write`
- Persist `workerClientCommand` in `config.json` when the local client executable differs from `opencode`
- Re-run `cw doctor`
- Use `cw doctor --probe` when you also want a live connectivity probe
- Read `local-client-command`, `local-client-compatibility`, `runtime-bootstrap`, and `worker-connectivity` together before changing paths blindly

## MCP Server Starts But Client Cannot Use It

### Symptoms

- `cw mcp serve` starts, but the client cannot list tools or connect reliably

### Checks

- Run `cw mcp list-tools` locally first
- Treat `cw mcp list-tools` and `cw mcp config` as local-only checks; they do not prove that the host loaded the MCP snippet
- Start the client against the correct workspace root
- Compare the client snippet with the output of `cw mcp config`
- Use `cw doctor --mcp --host=codex` when Codex is the host and you want an end-to-end check of config presence, snippet validity, launchability, connectivity, and tool-list parity
- Confirm the client process starts from the intended workspace root and is using the expected CW `config.json`
- Read `root-dir`, `runtime-bootstrap`, and `worker-connectivity` from `cw doctor --probe` to verify the active root, config path, and worker wiring
- Do not use a bare `cw mcp serve` run as the primary health check; as a stdio server it can exit once stdio closes or no client remains attached

## Patch Apply Is Blocked

### Symptoms

- `cw patch apply` refuses to write
- task resume with patch apply does not proceed

### Checks

- Confirm you passed both `--allow-write` and `--confirm-apply`
- Confirm the patch proposal passed inspection first
- Confirm the worktree state is acceptable for apply

Patch proposal, inspection, and apply are intentionally separate steps.

## Dry-run Behavior Is Confusing

### Symptoms

- commands appear to work but no repository files changed

### Checks

- Remember that dry-run is the default
- `--allow-write-session` only permits task-session artifacts under `runs/`
- It does **not** enable repository writes
- Repository writes remain gated behind explicit write-enabled commands

## Clean-up Commands Did Not Touch Source Files

This is expected.

- `cw cleanup runs` only removes CW-managed task artifacts
- `cw cleanup audit` only removes local audit artifacts
- neither command touches project source files

## What To Capture When Asking For Help

When escalating an issue, collect:

- the failing command
- whether you used npm install or a repository checkout
- Node.js version
- pnpm version
- whether the client is launching from the expected workspace root
- the relevant worker id, provider, and model if the issue is worker-specific
- sanitized error output

Never include raw API keys, bearer tokens, or secret-bearing config files in a bug report.
