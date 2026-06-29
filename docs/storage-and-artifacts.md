# Storage And Artifacts

`mcp-code-worker` keeps local managed state outside the repository checkout by default.

The default base path is:

```text
~/.cw/workspaces/<workspace-id>/
```

The default `~/.cw` root is always used for user-scoped CW state. `--root` on supported CLI commands changes which repository path maps to `<workspace-id>`.

## Common Files And Directories

Typical CW-managed files include:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `worker-benchmarks/`
- `runs/`
- `audit/`

## Task Session Artifacts

Task sessions are stored under:

```text
~/.cw/workspaces/<workspace-id>/runs/<taskId>/
```

Common artifacts include:

- `report.md`
- `validation-report.json`
- `patch-proposal.json`
- `patch-inspection.json`
- `patch-apply-result.json`

These files are review artifacts, not repository source files.

## Worker Qualification Artifacts

Worker qualification state is stored in user-scoped CW storage:

- registrations: `workers.json`
- profiles: `worker-profiles.json`
- benchmarks: `worker-benchmarks/<sanitized-worker-id>/coding-v1.json`

`<sanitized-worker-id>` is a filesystem-safe form of the worker id.

## Audit Artifacts

Audit events are local CW artifacts under:

```text
~/.cw/workspaces/<workspace-id>/audit/
```

Dry-run does not create audit files by default for ordinary evaluation paths, but explicit audit-writing paths still remain local to CW storage.

## Cleanup Scope

- `cw cleanup runs` removes aged task-session artifacts under `runs/`
- `cw cleanup audit` removes aged local audit artifacts under `audit/`

Neither cleanup command modifies repository source files.

## Storage Review Tips

When something looks “missing,” verify:

- the active repository root
- the active CW storage root under `~/.cw`
- the derived workspace id
- whether the state was created by `cw init`, task sessions, or audit-producing actions

The most common source of confusion is not data loss but a different effective root or CW home path.
