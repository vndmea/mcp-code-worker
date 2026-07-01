# Storage And Artifacts

`mcp-code-worker` keeps local managed state outside the repository checkout by default.

The default base path is:

```text
~/.code-worker/<workspace-id>/
```

By default CW uses `~/.code-worker` for user-scoped state. Set
`CW_STORAGE_DIR` to override that base directory. `--root` on supported CLI
commands changes which repository path maps to `<workspace-id>`.

## Common Files And Directories

Typical CW-managed workspace files include:

- `config.json`
- `data.db`

`config.json` remains human-editable and stores worker definitions plus runtime
defaults. `data.db` is the SQLite store for worker secrets, worker profiles,
latest benchmark records per worker and suite, task sessions, task artifacts,
and audit events.

## Task Session Artifacts

Task sessions are stored in SQLite under:

```text
~/.code-worker/<workspace-id>/data.db#task_sessions
```

Common artifacts include:

- `repository-context.summary.json`
- `review-result.summary.json`
- `report.md`
- `validation-report.json`
- `patch-proposal.json`
- `patch-inspection.json`
- `patch-apply-result.json`

`repository-context.summary.json` and `review-result.summary.json` are
lightweight summary artifacts. They keep file paths, counts, selection reasons,
validation summaries, and review findings without storing repository file
contents.

These logical artifacts are review artifacts, not repository source files. Use
`cw task report`, `cw read-task-artifact`, or the returned artifact refs to read
them back instead of expecting stable filesystem paths.

## Worker Qualification Artifacts

Worker qualification state is stored in user-scoped CW storage:

- registrations and non-secret worker defaults: `config.json.workers[]`
- profiles: `data.db#worker_profiles`
- benchmarks: `data.db#worker_benchmarks`

Benchmark retention keeps only the latest persisted row per
`(worker_id, suite_name)`.

## Audit Artifacts

Audit events are local CW artifacts in:

```text
~/.code-worker/<workspace-id>/data.db#audit_events
```

Dry-run does not create persisted audit rows by default for ordinary evaluation paths, but explicit audit-writing paths still remain local to CW storage.

## Cleanup Scope

- `cw cleanup runs` prunes persisted task-session rows from SQLite
- `cw cleanup audit` prunes persisted audit rows from SQLite

Default retention is:

- runs: latest `1` task session per retention group
- audit: latest `3` events per event type

Neither cleanup command modifies repository source files.

## Storage Review Tips

When something looks “missing,” verify:

- the active repository root
- the active CW storage root under `~/.code-worker`
- the derived workspace id
- whether the state was created by `cw init`, task sessions, or audit-producing actions

The most common source of confusion is not data loss but a different effective root or CW home path.
