# Configuration

This document explains how runtime configuration is resolved in `mcp-code-worker` and which settings affect worker routing, storage, safety, and MCP behavior.

## Resolution Order

Runtime configuration resolves in this order:

1. CLI flags
2. `~/.code-worker/<workspace-id>/config.json`
3. built-in defaults

This means a CLI override wins over persisted user-scoped CW config, and persisted CW config wins over built-in defaults for runtime settings.

## Supported Environment Variables

### MCP / runtime identity

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`
- `CW_STORAGE_DIR`

## Persisted User-scoped Config

See [docs/examples/cw-config.example.json](https://github.com/vndmea/mcp-code-worker/blob/master/docs/examples/cw-config.example.json) for an example shape.

By default, the resolved config file lives at:

- macOS / Linux: `~/.code-worker/<workspace-id>/config.json`
- Windows: `%USERPROFILE%/.code-worker/<workspace-id>/config.json`

The persisted config is intended for workspace-local runtime defaults such as:

- per-worker provider, model, and base URL entries in `config.json.workers[]`
- per-worker local client bridge commands in `config.json.workers[][*].clientCommand`
- validation script preferences
- default ignored paths
- SQLite retention settings under `storage.runs` and `storage.audit`
  By default CW keeps the latest `1` run per retention group and the latest
  `3` audit events per event type.
- worker and MCP-adjacent runtime defaults that should stay consistent across CLI and MCP entrypoints

`CW_STORAGE_DIR` overrides the default `~/.code-worker` base directory for
user-scoped CW state. The workspace-specific `config.json` and `data.db` still
resolve under `<workspace-id>` inside that override directory.

Provider families currently split into two broad groups:

- hosted API providers such as `openai-compatible`, `claude-compatible`, and `litellm`
- local CLI adapter providers such as `client`, `opencode`, `claudecode`, and `codex`

Default local command assumptions:

- `client` -> `sparkcode`
- `opencode` -> `opencode`
- `claudecode` -> `claude`
- `codex` -> `codex`

Persisted config no longer chooses an implicit execution worker for task, patch, or host-worker flows. Those commands now require an explicit named `workerId` at runtime.

Worker API keys are persisted in the user-scoped SQLite store, not in `config.json`. Keep them local to the machine, never commit them into repository files, and avoid pasting them into logs or shared transcripts.

Path-like inputs such as `config.json.workers[][*].clientCommand` are normalized before use so mixed slash styles like `C:/Users/me//tool.exe` and `.\bin\client` do not crash the runtime on the current platform.

## Repository Context Defaults

The default context budget includes:

- `strictFiles: false`
- ignored paths:
  - `node_modules`
  - `.git`
  - `dist`
  - `build`
  - `coverage`
  - `.turbo`
  - `.next`

Review, fix, patch, and task workflows use these defaults unless a command or config override changes them.

## Worker Model Defaults

If no worker model is configured explicitly, the runtime falls back to:

- provider: `mock`
- model: `gpt-5.4-mini`
- temperature: `0.1`

These are runtime defaults, not a statement that every workflow should use them in production.

## Recommended Validation After Configuration Changes

After changing configuration, run:

```bash
cw doctor
cw doctor --probe
cw mcp list-tools
```

If the configuration affects worker routing, continue with the explicit advanced flow:

```bash
cw worker register --worker=<workerId> --provider=<provider> --model=<model> --allow-write
cw worker interview --worker=<workerId> --save
```

## Related Documents

- [docs/provider-config.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-config.md)
- [docs/mcp-client-setup.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-client-setup.md)
- [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md)
