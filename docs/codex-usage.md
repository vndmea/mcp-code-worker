# Codex Usage

Use `cw_start_task` as the default high-level coding task entrypoint for Codex and GPT clients.

Codex stays in charge. `cw` should be treated as the controlled execution/runtime layer that narrows repository context, routes workers, records artifacts, and runs validation.

Recommended call order:

1. Call `cw_start_task` with `goal`, optional `scope`, and deterministic validation flags.
2. Read `nextRecommendedActions` from the result instead of guessing the next step.
3. Review the persisted `report.md` artifact through `cw_get_task_report` or `cw_read_task_artifact` before any patch apply attempt.
4. Prefer `proposePatch=true` and `inspectPatch=true` first.
5. Use patch apply only after manual review. Keep the first apply in dry-run mode unless a human explicitly wants writes.

When to use `cw_run_host_worker`:

- Use it only when Codex wants one explicit worker task such as `review-lite` or `summarization`.
- Treat it as a narrow worker invocation surface, not as a second planning or acceptance layer.
- If the task needs multi-step orchestration or patch lifecycle management, go back to `cw_start_task`.

> Warning:
> Delegating to a weaker worker does not automatically reduce total token usage. If Codex still has to re-read the same evidence, rewrite the answer, or re-run the reasoning, the combined cost can be higher than doing the work directly.
> Worker delegation is more likely to save tokens when the output is easy to check mechanically, such as small-scope extraction, classification, command execution, or artifact collection.

When to require a profile:

- Set `requireProfile=true` when routing higher-risk coding tasks to a specific worker.
- Leave `requireProfile` unset for exploratory or low-risk dry-run analysis when profile coverage is not mandatory.
- For `patch-generation`, treat a persisted profile plus benchmark-qualified capability update as the preferred path before delegating real patch proposal work.

When to propose but not apply:

- Default to patch proposal only when the user wants reviewable implementation options.
- Keep apply gated behind `allowWrite=true` and `confirmApply=true`.
- If validation already looks unstable, stop at proposal plus report review.

How to read task artifacts:

- `report.md` is the fastest human-readable summary artifact.
- `patch-proposal.json`, `patch-inspection.json`, and `patch-apply-result.json` contain the structured patch lifecycle.
- `validation-report.json` and `fix-result.json` explain deterministic failures and recovery guidance.

Worker evaluation layers:

- `cw worker interview --worker=<workerId> --save` establishes onboarding trust and baseline routing limits.
- `cw worker benchmark --suite=coding-v1 --worker=<workerId> --save` records coding benchmark results in the workspace SQLite store.
- `cw worker benchmark --suite=coding-v1 --worker=<workerId> --save --update-profile-capabilities` is the explicit step that can enable `patch-generation` on an existing persisted profile when the benchmark passes the required fixtures.
- Benchmark results alone do not bypass patch inspection, dry-run apply, `allowWrite`, or `confirmApply`.
