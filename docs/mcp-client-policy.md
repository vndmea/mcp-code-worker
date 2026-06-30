# MCP Client Policy

Policy for MCP clients integrating with mcp-code-worker:

- Prefer `cw_start_task` over composing lower-level tools manually.
- Treat `nextRecommendedActions` as the primary machine-readable hint for follow-up calls.
- Do not bypass `dry-run`, `allowWrite`, `allowDirtyWorktree`, or `confirmApply`.
- Do not assume a proposed patch is safe to apply until `patchInspection.ok === true` and a human has reviewed it.
- Always surface the persisted report artifact or `cw_get_task_report` output to the operator before write actions.

Recommended patterns:

- Review-only: `cw_start_task` with validation and `proposePatch=true`, `inspectPatch=true`, `applyPatch=false`.
- Dry-run apply: follow a `dry_run_apply` next action with `cw_resume_task`.
- Confirmed apply: follow a `confirm_apply` next action only after explicit human approval.

Client expectations:

- `cw_start_task` and `cw_resume_task` are thin orchestration wrappers; the structured artifacts remain the source of truth.
- `requireProfile=true` should be used when a client needs explicit worker qualification before delegated coding work.
- Recovery guidance from `patchApplyResult.recovery` must be shown verbatim or faithfully summarized when validation fails after apply.
- Worker onboarding and coding qualification are separate signals:
  - Interviewed profiles establish baseline routing safety.
  - Benchmarks update `evaluationSummary`.
  - Only an explicit capability update path should promote `patch-generation` on a persisted profile.
