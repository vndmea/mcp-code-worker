# Troubleshooting

Use this guide for the most common setup, runtime, MCP, and worker qualification issues in `mcp-code-worker`.

## Quick Checks First

Start every investigation with:

```bash
cw doctor
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
- Or set `CW_ROOT_DIR`
- Re-run `cw mcp config` after changing root assumptions

Different absolute repository roots produce different workspace ids, so a root mismatch can look like “missing” state when the real issue is path resolution.

## CW State Is Not Where You Expected

### Symptoms

- `workers.json`, `worker-profiles.json`, or `runs/` are not under the path you expected
- one checkout cannot see state created by another

### Checks

- Confirm whether `CW_HOME_DIR` is set
- Confirm whether `CW_ROOT_DIR` changed
- Remember that default state lives under `~/.cw/workspaces/<workspace-id>/`

## Worker Interview Is Blocked By Provider Failures

### Symptoms

- `cw worker interview --save` returns provider invocation failures
- the resulting profile is blocked for provider/configuration reasons

### Checks

- Confirm `WORKER_MODEL_API_KEY` is set in the same runtime that launches `cw`
- Confirm the provider name, model name, and base URL are correct
- For DeepSeek-compatible workers, test both documented base URLs if needed
- Re-run the health checks in [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)

Do not treat a provider-failure-style blocked interview as a completed onboarding result.

## Local Client Provider Cannot Launch

### Symptoms

- worker execution fails before the model call
- a local compatible client cannot be found

### Checks

- If you use the local client provider, remember that `opencode` is the default compatible command
- Prefer persisting `workerClientCommand` in `config.json` or via `cw setup --worker-client-command <command> --allow-write`
- Use `CW_WORKER_CLIENT_COMMAND` only as a temporary runtime override
- Re-run `cw doctor` after changing the command path

## MCP Server Starts But Client Cannot Use It

### Symptoms

- `cw mcp serve` starts, but the client cannot list tools or connect reliably

### Checks

- Run `cw mcp list-tools` locally first
- Start the client against the correct workspace root, or set `CW_ROOT_DIR`
- Compare the client snippet with the output of `cw mcp config`
- Confirm the client process sees the same environment variables as your shell

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
- whether `CW_ROOT_DIR` or `CW_HOME_DIR` is set
- the relevant worker id, provider, and model if the issue is worker-specific
- sanitized error output

Never include raw API keys, bearer tokens, or secret-bearing config files in a bug report.
