# MCP Server

The MCP server is a first-class interface for `mcp-code-worker`.

The MCP layer is intentionally thin. It delegates to the same workflow functions used by the CLI and keeps orchestration state in user-scoped CW workspace storage.

In host-driven use, treat `cw` as the controlled execution/runtime layer:

- The host keeps user intent and final acceptance.
- `cw` keeps worker execution, repository context, validation, artifacts, and patch gates explicit.
- `cw_start_task` is the default control surface for coding flows.

Use `cw_start_task` as the default high-level entrypoint for coding flows, and follow `nextRecommendedActions` instead of composing patch lifecycle steps by hand.

Named worker execution is explicit over MCP as well:

- `cw_start_task` requires `workerId`
- `cw_propose_patch` requires `workerId`
- `cw_run_host_worker` requires `workerId`

When you need a narrower host-managed worker check, use `cw_run_host_worker` or `cw_review_files` with explicit files and `strictFiles=true`. Those paths now expose debug evidence such as requested files, selected files, worker metadata, and `worker-debug.json` artifacts.

## Root Directory Resolution

By default, the MCP server resolves `rootDir` from the server process cwd. When an MCP client launches `cw` from a shared tools checkout instead of the active workspace, set `CW_WORKSPACE_DIR` in the server environment:

```json
{
  "mcpServers": {
    "mcp-code-worker": {
      "command": "cw",
      "args": ["mcp", "serve"],
      "env": {
        "CW_WORKSPACE_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

Regular CLI commands can still take their own `--root` flags where supported, but the MCP entrypoint itself does not expose `--root`.

Treat that MCP snippet as launch-only. Worker/provider/base URL/local client defaults should be persisted in `config.json` so both CLI commands and MCP tools resolve the same runtime settings.

If the resolved worker model uses the local client provider, `opencode` is the default command. Persist a different compatible local CLI with `workerClientCommand` in `config.json` or `cw init --worker-client-command <command> --allow-write`.

Example:

```json
{
  "version": 1,
  "workerClientCommand": "/path/to/compatible-client"
}
```

## Storage Resolution

By default, the MCP server stores CW-managed state under:

```text
~/.cw/workspaces/<workspace-id>/
```

- `CW_STORAGE_DIR` overrides the `~/.cw` root.
- `rootDir` determines `<workspace-id>`.
- Two different absolute checkouts of the same repository produce different workspace ids.
- If you need shared CW state across tools or checkouts, set the same `CW_STORAGE_DIR` intentionally.

## Tool Categories

- Host-facing execution: task sessions, review, fix, patch proposal, and explicit worker-task execution.
- Patch lifecycle gates: inspect and apply remain explicit, separate safety steps.
- Worker management: registry, profile, onboarding interview, and benchmark-driven capability qualification.
- Host-managed workflow building blocks: explicit worker execution plus patch lifecycle utilities.
- Diagnostics and audit: doctor, audit event listing, model and workflow inspection.

## Exposed Tools

- `cw_run_host_worker`
- `cw_propose_patch`
- `cw_inspect_patch`
- `cw_apply_patch`
- `cw_review_repository`
- `cw_review_diff`
- `cw_review_files`
- `cw_validate_repository`
- `cw_fix_error`
- `cw_start_task`
- `cw_resume_task`
- `cw_get_task_status`
- `cw_list_tasks`
- `cw_get_task_report`
- `cw_read_task_artifact`
- `cw_list_models`
- `cw_list_workflows`
- `cw_list_tools`
- `cw_list_audit_events`
- `cw_register_worker`
- `cw_unregister_worker`
- `cw_list_worker_registry`
- `cw_get_worker_registration`
- `cw_run_worker_interview`
- `cw_benchmark_worker`
- `cw_list_workers`
- `cw_get_worker_profile`
- `cw_doctor`

## Recommended Entry Points

- Internal trial workflow: start with `docs/trial-runbook.md`.
- MCP client integration: start with `cw_start_task`, `cw_resume_task`, and `cw_get_task_report`.
- New-user onboarding: start with `docs/minimal-success-path.md` and `cw init`.
- Command/operator detail: refer to `docs/cli.md`.
- Workspace install and launch: refer to `docs/install.md`.

For host-driven coding flows:

1. Use `cw_start_task` when you want CW to manage repository context, validation, task artifacts, and patch lifecycle.
2. Use `cw_run_host_worker` only when the host wants one narrow worker task under explicit control, and prefer explicit files plus `strictFiles=true` for hard-scope review tasks.
3. Use `cw_list_workflows` only to inspect the remaining host-managed workflow surfaces.

For worker qualification over MCP, use:

1. `cw_register_worker`
2. `cw_run_worker_interview` with `persistProfile=true` when the new profile should replace the persisted capability record
3. `cw_benchmark_worker` with artifact persistence and optional capability promotion

## Artifact-Oriented Usage

Task-oriented tools are expected to persist reviewable artifacts under `cwStorageDir/runs/<taskId>` when `allowWriteSession=true`.

Typical artifacts include:

- `report.md`
- `validation-report.json`
- `patch-proposal.json`
- `patch-inspection.json`
- `patch-apply-result.json`
- `worker-debug.json` within worker result artifacts when a host-managed worker task runs

Use `cw_read_task_artifact` for the minimum safe artifact-read path when a task response only returns refs.

Task-oriented MCP tools, including `cw_propose_patch`, default to summary-oriented responses. Use these optional fields when the client needs more or less detail:

- `detailLevel`: `summary` or `full`
- `includeArtifactRefs`: include or suppress persisted artifact refs
- `maxBytes`: cap preview-style text fields such as report excerpts or validation diagnostics

MCP clients should surface report paths, `cw_get_task_report`, and/or `cw_read_task_artifact` output to operators before any write action.

## Keeping This Document In Sync

- `packages/mcp-server/src/tools/mcp-tool-catalog.ts` is the single source for the published tool list.
- `cw mcp list-tools` prints the current runtime-visible tool names.
- Tests should fail if the tool list in this document drifts from the catalog.
