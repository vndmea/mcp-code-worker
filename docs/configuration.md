# Configuration

This document explains how runtime configuration is resolved in `mcp-code-worker` and which settings affect worker routing, storage, safety, and MCP behavior.

## Resolution Order

Runtime configuration resolves in this order:

1. CLI flags
2. `~/.cw/workspaces/<workspace-id>/config.json`
3. Environment variables
4. built-in defaults

This means a CLI override wins over persisted user-scoped CW config, and persisted CW config wins over environment defaults for runtime settings.

## Core Environment Variables

### Worker model

- `WORKER_MODEL_PROVIDER`
- `WORKER_MODEL_NAME`
- `WORKER_MODEL_BASE_URL`
- `WORKER_MODEL_API_KEY`

### Optional provider helpers

- `LITELLM_BASE_URL`
- `CW_WORKER_CLIENT_COMMAND`

### MCP / runtime identity

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`

### Root and storage

- `CW_WORKSPACE_DIR`
- `CW_STORAGE_DIR`

### Safety defaults

- `CW_DRY_RUN`
- `CW_ALLOW_WRITE`
- `CW_ALLOWED_COMMANDS`

## Persisted User-scoped Config

See [docs/examples/cw-config.example.json](https://github.com/vndmea/mcp-code-worker/blob/master/docs/examples/cw-config.example.json) for an example shape.

By default, the resolved config file lives at:

- macOS / Linux: `~/.cw/workspaces/<workspace-id>/config.json`
- Windows: `%USERPROFILE%/.cw/workspaces/<workspace-id>/config.json`

The persisted config is intended for workspace-local runtime defaults such as:

- worker model provider, model, and base URL
- optional worker model API key
- local client bridge command via `workerClientCommand`
- validation script preferences
- default ignored paths
- session retention settings
- worker and MCP-adjacent runtime defaults that should stay consistent across CLI and MCP entrypoints

Persisted config no longer chooses an implicit execution worker for task, patch, or host-worker flows. Those commands now require an explicit named `workerId` at runtime.

If you choose to persist an API key in the user-scoped config, keep it local to the machine, never commit it into repository files, and avoid pasting it into logs or shared transcripts. Launch-location bootstrap values such as `CW_WORKSPACE_DIR` and `CW_STORAGE_DIR` remain environment-driven.

Path-like inputs such as `CW_WORKSPACE_DIR`, `CW_STORAGE_DIR`, and `workerClientCommand` are normalized before use so mixed slash styles like `C:/Users/me//tool.exe` and `.\bin\client` do not crash the runtime on the current platform.

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
cw worker register --worker <workerId> --provider <provider> --model <model> --allow-write
cw worker interview --worker <workerId> --save
```

## Related Documents

- [docs/provider-config.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-config.md)
- [docs/mcp-client-setup.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-client-setup.md)
- [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md)
