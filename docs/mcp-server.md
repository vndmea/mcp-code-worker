# MCP Server

The MCP server is a first-class interface for `agent-orchestrator`.

The MCP layer is intentionally thin. It delegates to the same workflow functions used by the CLI and keeps orchestration state in local artifacts under `.ao/`.

Use `ao_start_task` as the default high-level entrypoint for coding flows, and follow `nextRecommendedActions` instead of composing patch lifecycle steps by hand.

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
- Command/operator detail: refer to `docs/cli.md`.
- Workspace install and launch: refer to `docs/install.md`.

For worker qualification over MCP, use:

1. `ao_register_worker`
2. `ao_interview_worker` with profile persistence when appropriate
3. `ao_benchmark_worker` with artifact persistence and optional capability promotion

## Artifact-Oriented Usage

Task-oriented tools are expected to persist reviewable artifacts under `.ao/runs/<taskId>` when `allowWriteSession=true`.

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
