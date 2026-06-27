# Changelog

All notable changes to `mcp-code-worker` should be documented in this file.

The current internal trial line follows semantic-style version labels even while the repository remains private.

## [0.1.0-internal-trial] - 2026-06-26

### Added

- Trial runbook for internal onboarding, worker evaluation, and task session execution.
- Example CW config under `docs/examples/cw-config.example.json`.
- Installation guide for the current workspace-based internal-trial path.
- Permission model document covering dry-run, session writes, repository writes, patch apply gates, and local audit artifacts.
- Expanded MCP and CLI documentation aligned with current command and tool names.
- Interview diagnostics that distinguish provider invocation failures from completed worker evaluations.
- Summary-first MCP/CLI output shaping and a minimal task artifact reader for persisted task artifacts.
- User-scoped CW storage path helpers under `packages/core/src/storage/cw-paths.ts`.

### Changed

- Documented internal trial evidence requirements, config safety expectations, and current MCP tool surface.
- `patch propose` now supports the same summary/full output controls as other high-level CLI and MCP workflow entrypoints.
- `worker interview --save` now skips persistence when provider access fails and returns re-interview guidance instead of saving a misleading blocked profile.
- Validation reports now include compact diagnostic summaries so MCP and CLI clients can stay within tighter context budgets.
- CW local state now persists under `~/.cw/workspaces/<workspace-id>/` by default instead of repository-local `.cw/`.
- Legacy repository-local `.cw/` storage is no longer supported or read by current builds.
- `CW_HOME_DIR` now overrides the user-scoped storage root and `CW_ROOT_DIR` now overrides workspace binding for CLI and MCP launches.
- `cw setup` is now the primary onboarding path for creating config, worker registry/profile stores, runs, and audit directories.
- MCP workspace-root guidance now documents `--root` and `CW_ROOT_DIR` for workspace-scoped launches.

### Rollback Guidance

- Use the previous tagged or recorded internal trial commit SHA.
- Re-run `pnpm build`, `pnpm smoke`, and `pnpm smoke:dist` after rollback.
- Reuse persisted CW artifacts only after confirming they match the reverted version's storage model and path expectations.
