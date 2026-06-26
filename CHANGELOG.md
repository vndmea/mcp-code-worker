# Changelog

All notable changes to `agent-orchestrator` should be documented in this file.

The current internal trial line follows semantic-style version labels even while the repository remains private.

## [0.1.0-internal-trial] - 2026-06-26

### Added

- Trial runbook for internal onboarding, worker evaluation, and task session execution.
- Example AO config under `docs/examples/ao-config.example.json`.
- Expanded MCP and CLI documentation aligned with current command and tool names.
- Interview diagnostics that distinguish provider invocation failures from completed worker evaluations.

### Changed

- Documented internal trial evidence requirements, config safety expectations, and current MCP tool surface.
- `worker interview --save` now skips persistence when provider access fails and returns re-interview guidance instead of saving a misleading blocked profile.

### Rollback Guidance

- Use the previous tagged or recorded internal trial commit SHA.
- Re-run `pnpm build`, `pnpm smoke`, and `pnpm smoke:dist` after rollback.
- Reuse persisted `.ao` artifacts only after confirming they match the reverted version's expectations.
