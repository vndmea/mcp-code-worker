# Internal Trial RC Matrix

Use this matrix before upgrading from individual internal trial to team trial.

Do not mark a gate complete without committed or attached evidence. For storage-aware gates, use user-scoped CW paths such as `~/.cw/workspaces/<workspace-id>/runs/<taskId>/report.md`.

## Release Candidate Checklist

| Area | Gate | Status | Evidence |
| --- | --- | --- | --- |
| Quality gate | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm smoke`, `pnpm smoke:dist` all pass | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Worker onboarding | At least one real worker interview completed and persisted successfully | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Worker benchmark | At least one `coding-v1` benchmark artifact saved for the same worker | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Provider robustness | Provider invocation failures return re-interview guidance and do not persist misleading blocked profiles | [x] | `packages/graph/src/workflows/worker-interview-workflow.test.ts`; `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Task session | At least one end-to-end task session completed with persisted report and validation artifacts | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Artifact reader | `cw_read_task_artifact` can read at least one persisted task artifact from refs | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Output shaping | Summary/full output modes verified for MCP and CLI entrypoints used in trial | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Safety gates | Patch apply still requires inspection plus explicit write/apply confirmation | [x] | `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Documentation | `docs/cli.md`, `docs/mcp-server.md`, and `docs/trial-runbook.md` match current commands and storage behavior | [x] | CLI and MCP qualification recorded in `docs/evidence/deepseek-internal-trial-2026-06-26.md` |
| Governance | Branch protection / required checks plan documented before team trial | [x] | `docs/repository-governance.md` prepared; current sign-off remains individual internal use |

## Sign-Off

- RC identifier: `0.1.0-internal`
- Evaluator: local operator (Codex-assisted)
- Decision: promote
- Notes: Real DeepSeek `flash` and `pro` qualification completed on 2026-06-26. Before any shared team trial, clear the operator-level `NODE_TLS_REJECT_UNAUTHORIZED=0` override and enable the documented branch protections.
