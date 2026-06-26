# Internal Trial RC Matrix

Use this matrix before upgrading from individual internal trial to team trial.

## Release Candidate Checklist

| Area | Gate | Status | Evidence |
| --- | --- | --- | --- |
| Quality gate | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm smoke`, `pnpm smoke:dist` all pass | [ ] | |
| Worker onboarding | At least one real worker interview completed and persisted successfully | [ ] | |
| Worker benchmark | At least one `coding-v1` benchmark artifact saved for the same worker | [ ] | |
| Provider robustness | Provider invocation failures return re-interview guidance and do not persist misleading blocked profiles | [ ] | |
| Task session | At least one end-to-end task session completed with persisted report and validation artifacts | [ ] | |
| Artifact reader | `ao_read_task_artifact` can read at least one persisted task artifact from refs | [ ] | |
| Output shaping | Summary/full output modes verified for MCP and CLI entrypoints used in trial | [ ] | |
| Safety gates | Patch apply still requires inspection plus explicit write/apply confirmation | [ ] | |
| Documentation | `docs/cli.md`, `docs/mcp-server.md`, and `docs/trial-runbook.md` match current commands and tools | [ ] | |
| Governance | Branch protection / required checks plan documented before team trial | [ ] | |

## Sign-Off

- RC identifier:
- Evaluator:
- Decision: promote / hold
- Notes:
