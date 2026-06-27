# Permissions

`agent-orchestrator` uses a layered permission model so read, local artifact writes, and repository writes do not collapse into a single switch.

## Permission Layers

- `read-only`: repository reads, diff inspection, task/status/report reads, and validation planning.
- `session-write`: local task artifacts under `aoStorageDir/runs/<taskId>`.
- `project-write`: repository file writes when a command explicitly supports them.
- `patch-apply`: the second gate for mutating source files through patch application.
- `audit-write`: local audit events under `aoStorageDir/audit`.

## Default Behavior

- Default mode is dry-run.
- Dry-run does not create audit files by default for ordinary evaluation paths.
- Repository reads and safe inspection commands can still run in dry-run mode.
- Worker outputs are not accepted until host review completes.

## Gates

- `--allow-write-session` allows `aoStorageDir/runs` persistence only.
- `--allow-write` allows commands with write support to modify local managed files or repository files, depending on the command.
- `--confirm-apply` is required in addition to `--allow-write` before `patch apply` can touch project files.

Patch apply stays explicitly two-step:

1. generate and inspect a proposal
2. apply only with `--allow-write --confirm-apply`

## User-Scoped AO Storage

By default, local AO state is stored under:

```text
~/.ao/workspaces/<workspace-id>/
```

`AO_HOME_DIR` overrides the `~/.ao` root. `AO_ROOT_DIR` or explicit `--root` flags affect which repository path maps to `<workspace-id>`.

## What Writes Under `aoStorageDir`

Local-managed artifacts include:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `worker-benchmarks/`
- `runs/`
- `audit/`

`benchmark` artifacts are local AO artifacts, not project source files.

## What Can Modify Project Files

- `ao patch apply ... --allow-write --confirm-apply`
- task-session resume paths only when they explicitly reach patch apply with both gates

`ao fix error`, `ao review ...`, `ao validate`, and `ao patch propose` do not apply repository changes by themselves.

## Cleanup Scope

- `ao cleanup runs` only removes local task-session artifacts under `aoStorageDir/runs`.
- `ao cleanup audit` only removes local audit artifacts under `aoStorageDir/audit`.
- Cleanup commands do not touch project source files.
