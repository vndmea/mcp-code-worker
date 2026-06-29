# Known Limitations

This document lists current product boundaries and non-goals that users should understand before depending on `mcp-code-worker` in broader workflows.

## Product Scope

`mcp-code-worker` is a controlled execution runtime for multi-model engineering workflows via CLI and MCP server. It is not:

- a Codex clone
- an OpenCode clone
- a Cursor clone
- a Claude Code clone
- a chat UI
- a web app

## Current Behavioral Limits

- Dry-run is the default.
- Worker outputs are not final until the host accepts them.
- Patch application is intentionally separated from patch proposal and inspection.
- Repository writes require explicit gates.
- A worker that has not passed onboarding should not be treated as production-ready.

## Environment Limits

- CI currently validates Node.js `22`.
- Other Node.js `>=22` versions are best-effort until they are added to the CI matrix.
- The public install path is the npm package `mcp-code-worker`.
- The repository checkout path remains the recommended development path.

## State And Path Limits

- User-scoped CW state lives outside the repository checkout by default.
- Different absolute repository roots produce different workspace ids.
- Repository-local legacy `.cw/` directories are unsupported and ignored by current builds.

## MCP And Client Limits

- MCP integrations depend on correct root resolution via the server working directory or `CW_WORKSPACE_DIR`.
- Client-specific configuration surfaces vary by host; use the documented JSON snippets as the stable CW-side contract rather than assuming a client-specific file path.

## Worker Qualification Limits

- Worker execution now requires an explicit named `workerId`; CW no longer guesses an execution worker for task, patch, or host-worker flows.
- Benchmark results do not bypass patch gates.
- Provider invocation failures during interview should be treated as configuration or connectivity problems, not as completed qualification results.
- `patch-generation` should only be promoted after explicit benchmark review and capability update.
- A weaker worker model is not automatically cheaper in total token cost if a stronger host model still has to verify or redo most of its output.
- Token savings are more realistic when workers are constrained to narrow, low-risk, mechanically verifiable subtasks.
