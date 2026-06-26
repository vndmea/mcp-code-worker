# Internal Trial RC Matrix

Use this matrix before upgrading from individual internal trial to team trial.

Do not mark a gate complete without committed or attached evidence. For storage-aware gates, use user-scoped AO paths such as `~/.ao/workspaces/<workspace-id>/runs/<taskId>/report.md` rather than older repository-local `.ao/...` paths.

## Release Candidate Checklist

| Area | Gate | Status | Evidence |
| --- | --- | --- | --- |
| Quality gate | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm smoke`, `pnpm smoke:dist` all pass | [ ] | CI URL or local signed log |
| Worker onboarding | At least one real worker interview completed and persisted successfully | [ ] | |
| Worker benchmark | At least one `coding-v1` benchmark artifact saved for the same worker | [ ] | Artifact path returned by CLI or `ao_benchmark_worker` |
| Provider robustness | Provider invocation failures return re-interview guidance and do not persist misleading blocked profiles | [ ] | |
| Task session | At least one end-to-end task session completed with persisted report and validation artifacts | [ ] | `~/.ao/workspaces/<workspace-id>/runs/<taskId>/report.md` plus task id |
| Artifact reader | `ao_read_task_artifact` can read at least one persisted task artifact from refs | [ ] | Task id plus artifact ref name |
| Output shaping | Summary/full output modes verified for MCP and CLI entrypoints used in trial | [ ] | |
| Safety gates | Patch apply still requires inspection plus explicit write/apply confirmation | [ ] | |
| Documentation | `docs/cli.md`, `docs/mcp-server.md`, `docs/trial-runbook.md`, and `docs/storage-migration.md` match current commands and storage behavior | [ ] | Note whether worker qualification used CLI, MCP, or both |
| Governance | Branch protection / required checks plan documented before team trial | [ ] | |

## Sign-Off

- RC identifier:
- Evaluator:
- Decision: promote / hold
- Notes:
