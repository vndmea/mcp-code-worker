# Supported Matrix

This document defines the explicit support boundary for `mcp-code-worker`.

If a platform, runtime, or MCP host is not listed here as supported, do not imply GA-level support for it in release notes, docs, or user guidance.

## Support Levels

- `supported`: part of the intended public support surface for the current release
- `documented best-effort`: documented guidance exists, but the target is not yet part of the release-grade validation matrix
- `unsupported`: not part of the promised public support surface

## Installation Path

| Surface | Level | Notes |
| ------- | ----- | ----- |
| Global npm install: `npm i -g mcp-code-worker` | supported | Primary end-user path |
| Repository checkout: `pnpm exec cw ...` | supported for development | Development and contributor path, not the primary end-user onboarding path |

## Operating Systems

| OS | Level | Validation basis | Notes |
| --- | ----- | ---------------- | ----- |
| Ubuntu Linux x64 | supported | CI validates quality gates, runtime smoke, and pack smoke | Automated on `ubuntu-latest` |
| Windows 11 x64 with PowerShell | documented best-effort | Full matrix automation is configured for quality, runtime smoke, and pack smoke | Promote to supported only after a green Windows row is recorded in `docs/release-readiness.md` for the release commit |
| macOS 14+ | documented best-effort | Full matrix automation is configured for quality, runtime smoke, and pack smoke | Promote to supported only after a green macOS row is recorded in `docs/release-readiness.md` for the release commit |

## Node.js

| Node.js version | Level | Notes |
| --------------- | ----- | ----- |
| 22.x LTS | supported | Current CI-validated runtime |
| Other `>=22` versions | documented best-effort | Do not market as fully supported until they are added to CI and release evidence |
| `<22` | unsupported | Outside the declared engine boundary |

## Package Manager

| Tool | Level | Notes |
| ---- | ----- | ----- |
| npm for global install | supported | Public install path |
| pnpm `>=10` for repository development | supported | Required for workspace development, build, and test commands |

## MCP Hosts

The MCP runtime contract is stdio-based. A host must be able to:

- launch `cw mcp serve`
- launch the server from the intended repository root when workspace binding matters
- communicate with a stdio MCP server correctly

| Host / surface | Level | Notes |
| -------------- | ----- | ----- |
| Generic stdio MCP host that can launch `cw` and pass env | supported | This is the core MCP contract |
| Codex | supported | First-class host-driven use case, documented setup path, and first-party snippet preset via `cw mcp config --host codex` |
| VS Code MCP-capable integrations | documented best-effort | Docs exist and `cw mcp config --host vscode` provides a first-party snippet, but no host-specific automation yet |
| Cursor | documented best-effort | Docs exist and `cw mcp config --host cursor` provides a first-party snippet, but no host-specific automation yet |
| Claude Desktop | documented best-effort | Docs exist and `cw mcp config --host claude-desktop` provides a first-party snippet, but no host-specific automation yet |
| OpenCode | documented best-effort | Docs exist and `cw mcp config --host opencode` provides a first-party snippet, but no host-specific automation yet |

## Worker Provider Configuration

| Surface | Level | Notes |
| ------- | ----- | ----- |
| `config.json` for persisted runtime defaults | supported | Primary config surface for worker, validation, safety, local client defaults, and optional user-scoped provider API keys |
| Environment variables for launch bootstrap and safety defaults | unsupported | Launch from the correct cwd and persist runtime settings in `config.json` instead |
| Host MCP config as the place for worker/provider defaults | unsupported | Host snippets should stay launch-focused, not become the main runtime config surface |

## Release Rule

A release is not ready to claim support beyond this matrix unless:

1. the new target is validated on the release commit
2. the corresponding docs are updated
3. the release evidence explicitly records that validation

For Windows and macOS specifically, the release evidence must include green `quality`, `runtime-smoke`, and `package-smoke` results in `docs/release-readiness.md` before their support level can change from `documented best-effort` to `supported`.
