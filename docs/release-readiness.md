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
| Release version     | The intended semver tag is fixed for this release                | `0.1.0` |
| Release commit      | All validation was run against the exact release commit          | `c734da37a1cd47132cdf9d9ac9eaa7110187c64f` |
| Node.js version     | Validation was performed with Node.js `22`                       | `node --version` -> `v22.22.0` |
| pnpm version        | Validation was performed with `pnpm >=10`                        | `pnpm --version` -> `11.9.0` |
| Public install path | `npm i -g mcp-code-worker` works from a clean environment        | Verified by `pnpm smoke:pack` on 2026-06-28 |
| Distribution path   | The published package was prepared from `packages/cli/.publish/` | Verified by `pnpm --dir packages/cli run pack:publish` on 2026-06-28 |

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

### Recorded Release-Candidate Evidence

The following evidence was recorded on 2026-06-28 against candidate release commit `c734da37a1cd47132cdf9d9ac9eaa7110187c64f`.

- `pnpm smoke:pack`: passed
  - built the publishable CLI packages
  - packed and installed the staged npm tarball from a clean prefix
  - verified `cw --help`
  - verified `cw doctor`
  - verified `cw doctor --probe`
  - verified `cw setup --allow-write`
  - verified `cw mcp config`
  - verified `cw mcp list-tools`
  - verified that user-scoped `config.json` was created under the configured CW home root
- `pnpm --dir packages/cli run pack:publish`: passed
  - staged publish directory: `packages/cli/.publish/`
  - tarball filename: `mcp-code-worker-0.1.0.tgz`
  - staged files confirmed:
    - `README.md`
    - `README.zh-CN.md`
    - `dist/index.js`
    - `dist/main.js`
    - `package.json`
  - published manifest name confirmed: `mcp-code-worker`

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

Recorded result for candidate release commit `c734da37a1cd47132cdf9d9ac9eaa7110187c64f`:

- `pnpm --dir packages/cli run pack:publish`: passed on 2026-06-28
- `npm pack .publish --json`: returned `mcp-code-worker-0.1.0.tgz`
- clean-environment install validation: passed through `pnpm smoke:pack`
- additional public-install checks validated during `pnpm smoke:pack`:
  - `cw doctor --probe`
  - `cw setup --allow-write`
  - `cw mcp config`

## Documentation Checks

The release must ship with a complete public-facing documentation set for the supported install and workflow path.

### Required Documents

The following documents must exist and be reviewed on the release branch:

- `docs/release-readiness.md`
- `docs/install.md`
- `docs/supported-matrix.md`
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
- If an API key was persisted in the user-scoped `config.json`, confirm it stayed local, was not committed, and does not appear in captured logs or evidence.

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
| Maintainer         | `vndmea` | `2026-06-28` | Signed off against candidate release commit `c734da37a1cd47132cdf9d9ac9eaa7110187c64f`. |
| Packaging reviewer | `vndmea` | `2026-06-28` | `pnpm smoke:pack` and `pnpm --dir packages/cli run pack:publish` passed for the candidate release commit. |
| Docs reviewer      | `vndmea` | `2026-06-28` | Public install, MCP config, and support-matrix docs reviewed against the candidate release commit. |
| MCP reviewer       | `vndmea` | `2026-06-28` | MCP launch snippet and stdio packaging checks reviewed against the candidate release commit. |

Do not publish until every required reviewer signs off on the exact release commit.
