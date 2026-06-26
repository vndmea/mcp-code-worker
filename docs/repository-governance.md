# Repository Governance

Use this document when moving from personal internal trial to a shared team trial branch.

## Branch Protection

- Protect the default branch and any shared internal-trial branch.
- Require pull requests before merge.
- Require the CI validation check to pass before merge.
- Restrict who can bypass protection rules and document the approvers.

## Required Checks

This repository currently defines one GitHub Actions workflow at `.github/workflows/ci.yml`.

- Workflow name: `CI`
- Job name: `validate`
- Matrix: Node `22`
- Expected required check in GitHub: the check derived from `validate` on Node `22` (commonly rendered as `validate (22)`)

Before enabling required checks, confirm the exact check label shown in the repository's Branch protection UI and copy that exact label into the rule.

## Merge Policy

- Do not merge when `typecheck`, `lint`, `test`, `build`, `smoke`, or `smoke:dist` failed in CI.
- Do not merge a branch that used `--allow-write` patch application without keeping the task session report and inspection artifacts.
- Do not bypass a failed worker onboarding or benchmark gate for a worker that will be used in shared trial flows.

## Operational Notes

- Keep the internal trial RC matrix in `docs/internal-trial-rc-matrix.md` with links to evidence.
- Keep one sanitized evidence record per real worker trial using `docs/examples/internal-trial-evidence-template.md`.
- Re-check required check names after workflow/job renames or matrix changes.
