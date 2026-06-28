# Release Readiness

**Project:** `mcp-code-worker`

This document is the release gate for the public npm package and the CLI + MCP runtime it exposes. A release is not ready until every required check below has been completed on the intended release commit and the corresponding evidence has been recorded.

## Purpose

Use this checklist to confirm that:

- the public install path works
- the CLI and MCP server behave as documented
- required user-facing documentation exists and is accurate
- worker safety gates still hold after packaging
- the published artifact matches what the repository documents

## Release Gate Checklist

All categories below must be complete before tagging and publishing:

- Version and release evidence
- Local quality gate
- Packaging checks
- Documentation checks
- MCP readiness checks
- Operational readiness checks
- Known limitations review
- Final sign-off

## Required Evidence

| Item                | Requirement                                                      | Evidence to record            |
| ------------------- | ---------------------------------------------------------------- | ----------------------------- |
| Release version     | The intended semver tag is fixed for this release                | `<fill-in>`                   |
| Release commit      | All validation was run against the exact release commit          | `<fill-in>`                   |
| Node.js version     | Validation was performed with Node.js `22`                       | `node --version` output       |
| pnpm version        | Validation was performed with `pnpm >=10`                        | `pnpm --version` output       |
| Public install path | `npm i -g mcp-code-worker` works from a clean environment        | install transcript or notes   |
| Distribution path   | The published package was prepared from `packages/cli/.publish/` | artifact path and pack output |

### Validation Commands

Record the outcome of each command from a clean checkout:

- `pnpm install`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm smoke`
- `pnpm smoke:pack`
- `pnpm smoke:dist`

If any command fails or needs an exception, the release is blocked until the result is reviewed and accepted explicitly.

## Packaging Checks

Validate the artifact that is actually going to npm:

- Run `pnpm --dir packages/cli run prepack`.
- Run `npm pack .publish --json` from `packages/cli` or use `pnpm --dir packages/cli run pack:publish`.
- Confirm the publish staging directory is `packages/cli/.publish/`.
- Confirm the published manifest name is `mcp-code-worker`.
- Confirm the published package exposes the `cw` command.
- Confirm the staged package contains the compiled `dist/` output, `README.md`, `package.json`, and any required runtime assets.
- Confirm the staged package does not contain development-only workspace files, local notes, or secret-bearing files.
- Install the staged tarball in a clean environment and verify:
  - `cw doctor`
  - `cw mcp list-tools`
  - `cw --help`

## Documentation Checks

The release must ship with a complete public-facing documentation set for the supported install and workflow path.

### Required Documents

The following documents must exist and be reviewed on the release branch:

- `docs/release-readiness.md`
- `docs/install.md`
- `docs/upgrade-rollback.md`
- `docs/mcp-client-setup.md`
- `docs/provider-config.md`
- `docs/worker-onboarding.md`
- `docs/first-task.md`
- `docs/troubleshooting.md`
- `docs/distribution.md`
- `docs/permissions.md`

### Accuracy Checks

For each required document, confirm:

- commands are syntactically correct
- the described workflow can be reproduced with the documented install path
- storage paths are described consistently with `~/.cw/workspaces/<workspace-id>/`
- no unsupported platform, packaging, or client claims are made
- examples that mention MCP root resolution align with `cw mcp serve` from the target workspace root and `CW_ROOT_DIR`

## MCP Readiness Checks

The MCP surface is part of the shipped product and must be validated directly.

### `cw mcp list-tools`

- exits with status `0`
- returns a non-empty tool list
- matches the tool catalog expected by the current build

### `cw mcp config`

- exits with status `0`
- prints a usable stdio configuration snippet
- produces output that matches the examples used in MCP client docs

### `cw mcp serve`

- starts successfully from the public install path
- resolves the current working directory as the workspace root when `CW_ROOT_DIR` is unset
- can be connected to by an MCP client or test harness
- returns the same tool list surfaced by `cw mcp list-tools`
- shuts down cleanly after the validation run

## Operational Readiness Checks

Operational checks ensure the packaged build still respects the documented safety model.

### Safety and write gates

- Dry-run remains the default behavior.
- Worker outputs still require host review before acceptance.
- `cw patch apply` still requires both `--allow-write` and `--confirm-apply`.
- Review, fix, validate, and patch proposal flows do not mutate project files by themselves.

### Storage checks

- Run `cw init` and confirm user-scoped CW storage is created under `~/.cw/workspaces/<workspace-id>/`.
- Confirm CW-managed files live in user-scoped storage rather than the repository checkout.
- Confirm `config.json`, `workers.json`, `worker-profiles.json`, `runs/`, and `audit/` appear where the documentation says they should.
- Confirm no API key was written into persisted config state during the validation run.

## Known Limitations / Non-release Conditions

Release must be blocked when any of the following is true:

- the public npm install path does not work
- any required validation command fails
- the packaged `cw` command cannot start cleanly
- MCP startup or tool listing fails
- required documentation files are missing or materially inaccurate
- dry-run is not the default
- patch apply can proceed without the documented gates
- repository-local legacy `.cw/` handling is required for the release scenario
- release notes or support claims imply environments or clients that were not actually validated

If a known limitation is accepted for the release, it must be listed explicitly in the release notes and support guidance.

## Sign-off Template

| Role               | Name        | Date        | Notes |
| ------------------ | ----------- | ----------- | ----- |
| Maintainer         | `<fill-in>` | `<fill-in>` |       |
| Packaging reviewer | `<fill-in>` | `<fill-in>` |       |
| Docs reviewer      | `<fill-in>` | `<fill-in>` |       |
| MCP reviewer       | `<fill-in>` | `<fill-in>` |       |

Do not publish until every required reviewer signs off on the exact release commit.
