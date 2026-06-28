# Configuration

This document explains how runtime configuration is resolved in `mcp-code-worker` and which settings affect worker routing, storage, safety, and MCP behavior.

## Resolution Order

Runtime configuration resolves in this order:

1. CLI flags
2. Environment variables
3. `~/.cw/workspaces/<workspace-id>/config.json`
4. built-in defaults

This means a CLI override wins over environment configuration, and environment configuration wins over persisted user-scoped CW config.

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

- `CW_ROOT_DIR`
- `CW_HOME_DIR`

### Safety defaults

- `CW_DRY_RUN`
- `CW_ALLOW_WRITE`
- `CW_ALLOWED_COMMANDS`

## Persisted User-scoped Config

See [docs/examples/cw-config.example.json](https://github.com/vndmea/mcp-code-worker/blob/master/docs/examples/cw-config.example.json) for an example shape.

The persisted config is intended for non-secret defaults such as:

- worker model provider, model, and base URL
- local client bridge command via `workerClientCommand`
- validation script preferences
- default ignored paths
- session retention settings

Do not put secrets into persisted config. API credentials should remain in environment variables.

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
cw mcp list-tools
```

If the configuration affects worker routing, continue with:

```bash
cw worker interview --provider <provider> --model <model>
```

## Related Documents

- [docs/provider-config.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-config.md)
- [docs/mcp-client-setup.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-client-setup.md)
- [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md)
