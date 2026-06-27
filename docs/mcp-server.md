# MCP Server

The MCP server is a first-class interface for `agent-orchestrator`.

The MCP layer is intentionally thin. It delegates to the same workflow functions used by the CLI and keeps orchestration state in user-scoped AO workspace storage.

Use `ao_start_task` as the default high-level entrypoint for coding flows, and follow `nextRecommendedActions` instead of composing patch lifecycle steps by hand.

## Root Directory Resolution

By default, the MCP server resolves `rootDir` from the server process cwd. When an MCP client launches `ao` from a shared tools checkout instead of the active workspace, pass an explicit root:

```json
{
  "mcpServers": {
    "agent-orchestrator": {
      "command": "ao",
      "args": ["mcp", "serve", "--root", "${workspaceFolder}"]
    }
  }
}
```

You can also set `AO_ROOT_DIR` in the server environment. Explicit CLI `--root` still wins over `AO_ROOT_DIR`.

If the resolved worker model uses the local client provider, `opencode` is the default command. Set `AO_WORKER_CLIENT_COMMAND` only when your compatible local CLI uses a different executable name or path.

Example:

```json
{
  "mcpServers": {
    "agent-orchestrator": {
      "command": "ao",
      "args": ["mcp", "serve", "--root", "${workspaceFolder}"],
      "env": {
        "AO_WORKER_CLIENT_COMMAND": "/path/to/compatible-client"
      }
    }
  }
}
```

## Storage Resolution

By default, the MCP server stores AO-managed state under:

```text
~/.ao/workspaces/<workspace-id>/
```

- `AO_HOME_DIR` overrides the `~/.ao` root.
- `rootDir` determines `<workspace-id>`.
- Two different absolute checkouts of the same repository produce different workspace ids.
- If you need shared AO state across tools or checkouts, set the same `AO_HOME_DIR` intentionally.

## Tool Categories

- High-level orchestration: task sessions, leader-worker orchestration, plan, review, fix, patch proposal.
- Patch lifecycle gates: inspect and apply remain explicit, separate safety steps.
- Worker management: registry, profile, onboarding interview, and benchmark-driven capability qualification.
- Diagnostics and audit: doctor, audit event listing, model and workflow inspection.

## Exposed Tools

- `ao_plan`
- `ao_run_workflow`
- `ao_run_leader_worker`
- `ao_propose_patch`
- `ao_inspect_patch`
- `ao_apply_patch`
- `ao_review_repository`
- `ao_review_diff`
- `ao_review_files`
- `ao_validate_repository`
- `ao_fix_error`
- `ao_start_task`
- `ao_resume_task`
- `ao_get_task_status`
- `ao_list_tasks`
- `ao_get_task_report`
- `ao_read_task_artifact`
- `ao_list_models`
- `ao_list_workflows`
- `ao_list_tools`
- `ao_list_audit_events`
- `ao_register_worker`
- `ao_unregister_worker`
- `ao_list_worker_registry`
- `ao_get_worker_registration`
- `ao_interview_worker`
- `ao_benchmark_worker`
- `ao_list_workers`
- `ao_get_worker_profile`
- `ao_doctor`

## Recommended Entry Points

- Internal trial workflow: start with `docs/trial-runbook.md`.
- MCP client integration: start with `ao_start_task`, `ao_resume_task`, and `ao_get_task_report`.
- New-user onboarding: start with `docs/minimal-success-path.md` and `ao setup`.
- Command/operator detail: refer to `docs/cli.md`.
- Workspace install and launch: refer to `docs/install.md`.

For worker qualification over MCP, use:

1. `ao_register_worker`
2. `ao_interview_worker` with profile persistence when appropriate
3. `ao_benchmark_worker` with artifact persistence and optional capability promotion

## Artifact-Oriented Usage

Task-oriented tools are expected to persist reviewable artifacts under `aoStorageDir/runs/<taskId>` when `allowWriteSession=true`.

Typical artifacts include:

- `report.md`
- `validation-report.json`
- `patch-proposal.json`
- `patch-inspection.json`
- `patch-apply-result.json`

Use `ao_read_task_artifact` for the minimum safe artifact-read path when a task response only returns refs.

Task-oriented MCP tools, including `ao_propose_patch`, default to summary-oriented responses. Use these optional fields when the client needs more or less detail:

- `detailLevel`: `summary` or `full`
- `includeArtifactRefs`: include or suppress persisted artifact refs
- `maxBytes`: cap preview-style text fields such as report excerpts or validation diagnostics

MCP clients should surface report paths, `ao_get_task_report`, and/or `ao_read_task_artifact` output to operators before any write action.

## Keeping This Document In Sync

- `packages/mcp-server/src/tools/mcp-tool-catalog.ts` is the single source for the published tool list.
- `ao mcp list-tools` prints the current runtime-visible tool names.
- Tests should fail if the tool list in this document drifts from the catalog.
