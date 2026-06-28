# Provider Configuration

`mcp-code-worker` keeps provider configuration explicit across persisted config and environment overrides. This document explains how to configure worker models safely and how to validate the result.

## Configuration Surfaces

The main worker model settings are:

- `WORKER_MODEL_PROVIDER`
- `WORKER_MODEL_NAME`
- `WORKER_MODEL_BASE_URL`
- `WORKER_MODEL_API_KEY`

Additional related settings include:

- `LITELLM_BASE_URL`
- `CW_WORKER_CLIENT_COMMAND`
- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`
- `CW_WORKSPACE_DIR`
- `CW_STORAGE_DIR`
- `CW_DRY_RUN`
- `CW_ALLOW_WRITE`
- `CW_ALLOWED_COMMANDS`

Runtime configuration resolves in this order:

1. CLI flags
2. `~/.cw/workspaces/<workspace-id>/config.json`
3. Environment variables
4. Built-in defaults

Treat `config.json` as the primary source for persisted worker settings used by both CLI and MCP flows. API keys can live either in the user-scoped `config.json` or in environment variables such as `WORKER_MODEL_API_KEY`; prefer the user-scoped config when you want one local config surface, and never commit real keys into repository files or logs.

## 3-Minute Quickstarts

These are the fastest supported paths for getting one worker configuration running without reading the entire document first.

### Quickstart: mock provider

Use this when you want to verify local CLI and MCP wiring first.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset mock --allow-write
```

2. Confirm the stored config points at `mock`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "mock",
    "model": "gpt-5.4-mini"
  }
}
```

3. Verify locally:

```bash
cw doctor
cw doctor --probe
cw mcp config
```

No API key is required for this path.

### Quickstart: OpenAI-compatible / DeepSeek-style API

Use this when you want a real hosted model quickly.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset deepseek --allow-write
```

2. Persist the runtime defaults in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "openai-compatible",
    "model": "deepseek-v4-flash",
    "baseURL": "https://api.deepseek.com",
    "apiKey": "sk-..."
  }
}
```

3. If you prefer environment variables instead, set the secret in the same runtime that will launch `cw`:

PowerShell:

```powershell
$env:WORKER_MODEL_API_KEY="sk-..."
```

bash:

```bash
export WORKER_MODEL_API_KEY="sk-..."
```

4. Verify the resolved runtime:

```bash
cw doctor
cw doctor --probe
```

If `cw doctor --probe` fails, check the reported `root-dir`, `runtime-bootstrap`, `worker-model`, and `worker-connectivity` diagnostics before changing anything else.

### Quickstart: Claude-compatible / Anthropic API

Use this when you want a Claude-native hosted model.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset opencode --allow-write
```

2. Persist the runtime defaults in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "claude-compatible",
    "model": "claude-3-5-sonnet-latest",
    "baseURL": "https://api.anthropic.com",
    "apiKey": "sk-ant-..."
  }
}
```

3. If you prefer environment variables instead, set the secret in the same runtime that will launch `cw`:

PowerShell:

```powershell
$env:WORKER_MODEL_API_KEY="sk-ant-..."
```

bash:

```bash
export WORKER_MODEL_API_KEY="sk-ant-..."
```

4. Verify the resolved runtime:

```bash
cw doctor
cw doctor --probe
```

If `cw doctor --probe` fails, check the reported `root-dir`, `runtime-bootstrap`, `worker-model`, and `worker-connectivity` diagnostics before changing anything else.

### Quickstart: local client provider

Use this when a compatible local CLI should proxy the model call.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init
```

2. Persist the provider and client command in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "client",
    "model": "qwen3-coder"
  },
  "workerClientCommand": "/path/to/compatible-client"
}
```

3. Verify locally:

```bash
cw doctor
cw doctor --probe
```

If this path fails, inspect the `local-client-command`, `local-client-compatibility`, `runtime-bootstrap`, and `worker-connectivity` checks first.

## Supported Provider Shapes

### `mock`

Use `mock` when you need deterministic local behavior without a real provider.

- Good for tests and local workflow validation.
- No API key is required.
- Contract:
  - [docs/provider-contracts/mock.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/mock.md)

### `openai-compatible`

Use `openai-compatible` for providers that expose an OpenAI-compatible API surface.

Typical settings:

```bash
WORKER_MODEL_PROVIDER=openai-compatible
WORKER_MODEL_NAME=<model>
WORKER_MODEL_BASE_URL=<base-url>
WORKER_MODEL_API_KEY=<secret>
```

Contracts:

- Generic:
  - [docs/provider-contracts/openai-compatible-generic.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/openai-compatible-generic.md)
- DeepSeek-specific:
  - [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)

### `claude-compatible`

Use `claude-compatible` when the upstream API is Claude / Anthropic native rather than OpenAI-compatible.

Typical settings:

```bash
WORKER_MODEL_PROVIDER=claude-compatible
WORKER_MODEL_NAME=<model>
WORKER_MODEL_BASE_URL=https://api.anthropic.com
WORKER_MODEL_API_KEY=<secret>
```

Contract:

- [docs/provider-contracts/claude-compatible.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claude-compatible.md)

### `litellm`

Use `litellm` when worker traffic should go through a LiteLLM gateway.

Typical settings:

```bash
WORKER_MODEL_PROVIDER=litellm
WORKER_MODEL_NAME=<model>
LITELLM_BASE_URL=<gateway-base-url>
```

If the worker should target a non-default endpoint, `WORKER_MODEL_BASE_URL` can still be used as the effective worker endpoint.

Contract:

- [docs/provider-contracts/litellm.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/litellm.md)

### `client`

Use a local client provider when a compatible local CLI bridges the model calls.

- `opencode` is the default compatible command.
- Persist `workerClientCommand` in `config.json` when the executable name or path differs.
- Use `CW_WORKER_CLIENT_COMMAND` only as a bootstrap fallback when no persisted config exists yet.

Example:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "client",
    "model": "<model-name>"
  },
  "workerClientCommand": "/path/to/compatible-client"
}
```

Contract:

- [docs/provider-contracts/local-client.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/local-client.md)

## Minimal Validation Flow

After changing provider configuration, run:

```bash
cw doctor
cw doctor --probe
cw worker list
```

If you are qualifying a real worker through the explicit advanced flow, continue with:

```bash
cw worker register --worker <workerId> --provider <provider> --model <model> --allow-write
cw worker interview --worker <workerId> --save
```

If coding qualification matters, then run:

```bash
cw worker benchmark --suite coding-v1 --worker <workerId> --save
```

Only use `--update-profile-capabilities` after reviewing the benchmark result explicitly.

## Troubleshooting Signals

Use these signals to narrow provider issues quickly:

- `cw doctor` reports missing or inconsistent worker model settings.
- `cw doctor --probe` shows whether the resolved worker can answer with the current runtime wiring.
- `cw worker interview --save` returns provider invocation failures.
- `cw mcp serve` works but worker-routed tasks fail because the MCP server environment does not contain the same provider variables as your shell.
- A local client provider fails because `workerClientCommand` or `CW_WORKER_CLIENT_COMMAND` points to the wrong executable, or an override is unnecessary.

If provider invocation fails during interview, do not treat the resulting unavailable outcome as a completed onboarding result. Fix connectivity or auth first, then rerun the interview.

For provider-specific health checks and failure signatures, use the matching contract document:

- [Mock](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/mock.md)
- [OpenAI-compatible generic](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/openai-compatible-generic.md)
- [DeepSeek](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)
- [Claude-compatible](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claude-compatible.md)
- [LiteLLM](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/litellm.md)
- [Local client](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/local-client.md)
