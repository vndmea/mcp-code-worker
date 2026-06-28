# Upgrade And Rollback

This document describes the supported version-change paths for `mcp-code-worker` and the checks you should run before and after changing versions.

Use this guide for two cases:

- the public npm install path (`npm i -g mcp-code-worker`)
- a repository checkout used for local development (`pnpm exec cw ...`)

## Before You Change Versions

Record the current environment before upgrading or rolling back:

- current `cw` version
- current Node.js version (`22` required)
- current pnpm version (`>=10`)
- whether you use the public install path or a repository checkout
- whether `CW_HOME_DIR` or `CW_ROOT_DIR` is set

Before changing versions:

1. Run `cw doctor`.
2. Run `cw mcp list-tools`.
3. If you rely on saved state, note the current workspace directory under `~/.cw/workspaces/<workspace-id>/`.
4. Back up any user-scoped CW state you cannot easily recreate, especially:
   - `config.json`
   - `workers.json`
   - `worker-profiles.json`
   - `worker-benchmarks/`
   - `runs/`
   - `audit/`

## Upgrade: Public npm Install Path

To move to the latest published version:

```bash
npm i -g mcp-code-worker
```

To move to a specific published version:

```bash
npm i -g mcp-code-worker@<version>
```

After upgrading, verify:

```bash
cw doctor
cw mcp list-tools
cw --help
```

If you use MCP clients, also verify:

```bash
cw mcp config
cw mcp serve
```

## Rollback: Public npm Install Path

To return to a known version:

```bash
npm i -g mcp-code-worker@<previous-version>
```

After rollback, rerun the same checks:

```bash
cw doctor
cw mcp list-tools
cw --help
```

If state-dependent workflows matter for the rollback decision, also verify:

- worker profiles can still be listed
- task reports can still be read
- MCP startup still works from the expected workspace root or with the expected `CW_ROOT_DIR`

## Upgrade: Repository Checkout Path

For local development, the supported path remains the repository checkout.

Typical upgrade flow:

```bash
git fetch
git checkout <target-branch-or-tag>
pnpm install
pnpm build
pnpm exec cw doctor
pnpm exec cw mcp list-tools
```

All `pnpm exec cw ...` commands should be run from the repository root.

## Rollback: Repository Checkout Path

To return to an earlier commit or tag in a development checkout:

```bash
git checkout <previous-branch-or-tag>
pnpm install
pnpm build
pnpm exec cw doctor
pnpm exec cw mcp list-tools
```

If a rollback spans a meaningful change in worker configuration or local state shape, validate the affected workflows before continuing.

## State And Root Resolution Notes

- `CW_HOME_DIR` changes the base CW home directory.
- `CW_ROOT_DIR` changes how the active repository root is resolved.
- Different absolute repository roots produce different workspace ids.
- Changing either variable can make existing state appear to “move” even when files were not deleted.

When diagnosing upgrade or rollback issues, always verify:

- the expected repository root
- the expected CW home directory
- the expected workspace id

## Recommended Post-change Validation

After any upgrade or rollback, run the smallest set of checks that matches your actual usage:

- CLI only:
  - `cw doctor`
  - `cw --help`
- MCP usage:
  - `cw mcp list-tools`
  - `cw mcp config`
  - `cw mcp serve`
- Worker usage:
  - `cw worker list`
  - `cw worker profile <workerId>`
- Task workflow usage:
  - `cw task report <taskId>`

## When To Stop And Restore From Backup

Stop and restore your saved CW state before continuing when:

- `cw doctor` fails after the version change
- the expected workspace root resolves incorrectly
- worker profiles disappear unexpectedly
- MCP startup fails for a version that previously worked
- task artifacts needed for audit or review can no longer be read

If rollback does not restore expected behavior, capture the failing command, the active version, and the relevant CW storage path before investigating further.
