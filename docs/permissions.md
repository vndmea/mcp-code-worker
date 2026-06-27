# Permissions

`mcp-code-worker` uses a layered permission model so read, local artifact writes, and repository writes do not collapse into a single switch.

## Permission Layers

- `read-only`: repository reads, diff inspection, task/status/report reads, and validation planning.
- `session-write`: local task artifacts under `cwStorageDir/runs/<taskId>`.
- `project-write`: repository file writes when a command explicitly supports them.
- `patch-apply`: the second gate for mutating source files through patch application.
- `audit-write`: local audit events under `cwStorageDir/audit`.

## Default Behavior

- Default mode is dry-run.
- Dry-run does not create audit files by default for ordinary evaluation paths.
- Repository reads and safe inspection commands can still run in dry-run mode.
- Worker outputs are not accepted until host review completes.

## Gates

- `--allow-write-session` allows `cwStorageDir/runs` persistence only.
- `--allow-write` allows commands with write support to modify local managed files or repository files, depending on the command.
- `--confirm-apply` is required in addition to `--allow-write` before `patch apply` can touch project files.

Patch apply stays explicitly two-step:

1. generate and inspect a proposal
2. apply only with `--allow-write --confirm-apply`

## User-Scoped CW Storage

By default, local CW state is stored under:

```text
~/.cw/workspaces/<workspace-id>/
```

`CW_HOME_DIR` overrides the `~/.cw` root. `CW_ROOT_DIR` or explicit `--root` flags affect which repository path maps to `<workspace-id>`.

## What Writes Under `cwStorageDir`

Local-managed artifacts include:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `worker-benchmarks/`
- `runs/`
- `audit/`

`benchmark` artifacts are local CW artifacts, not project source files.

## What Can Modify Project Files

- `cw patch apply ... --allow-write --confirm-apply`
- task-session resume paths only when they explicitly reach patch apply with both gates

`cw fix error`, `cw review ...`, `cw validate`, and `cw patch propose` do not apply repository changes by themselves.

## Cleanup Scope

- `cw cleanup runs` only removes local task-session artifacts under `cwStorageDir/runs`.
- `cw cleanup audit` only removes local audit artifacts under `cwStorageDir/audit`.
- Cleanup commands do not touch project source files.
