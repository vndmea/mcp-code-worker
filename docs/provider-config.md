# Provider Configuration

`mcp-code-worker` keeps provider configuration explicit in persisted workspace state. This document explains how to configure workers safely and how to validate the result.

## Configuration Surfaces

The main non-secret worker settings live in `config.json` under `workers[]`:

- `workerId`
- `provider`
- `model`
- `baseURL`
- `clientCommand`

Additional related settings include:

- `MCP_SERVER_NAME`
- `MCP_SERVER_VERSION`
- `LOG_LEVEL`

Runtime configuration resolves in this order:

1. CLI flags
2. `~/.code-worker/<workspace-id>/config.json`
3. Built-in defaults

Treat `config.json` as the primary source for persisted non-secret worker settings used by both CLI and MCP flows. Persist local client commands in `config.json.workers[]`, persist provider API keys in the workspace SQLite store, and never commit real keys into repository files or logs.

## 3-Minute Quickstarts

These are the fastest supported paths for getting one worker configuration running without reading the entire document first.

### Quickstart: mock provider

Use this when you want to verify local CLI and MCP wiring first.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset=mock --allow-write
```

2. Confirm the stored config points at `mock`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "mock-local",
      "provider": "mock",
      "model": "gpt-5.4-mini"
    }
  ]
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
cw init --preset=deepseek --allow-write
```

2. Persist the worker entry in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "deepseek-flash",
      "provider": "openai-compatible",
      "model": "deepseek-v4-flash",
      "baseURL": "https://api.deepseek.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

3. Verify the resolved runtime:

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
cw init --allow-write
```

2. Persist the worker entry in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "claude-sonnet",
      "provider": "claude-compatible",
      "model": "claude-3-5-sonnet-latest",
      "baseURL": "https://api.anthropic.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

3. Verify the resolved runtime:

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

2. Persist the worker entry in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "sparkcode-local",
      "provider": "client",
      "model": "qwen3-coder",
      "clientCommand": "/path/to/compatible-client",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

3. Verify locally:

```bash
cw doctor
cw doctor --probe
```

If this path fails, inspect the `local-client-command`, `local-client-compatibility`, `runtime-bootstrap`, and `worker-connectivity` checks first.

### Quickstart: Claude Code adapter

Use this when a local Claude Code CLI should proxy the worker call.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset=claudecode --allow-write
```

2. Persist the worker entry in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "claudecode-local",
      "provider": "claudecode",
      "model": "sonnet",
      "clientCommand": "/path/to/claude",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

3. Verify locally:

```bash
cw doctor
cw doctor --probe
```

If this path fails, inspect the `local-client-command`, `local-client-compatibility`, `runtime-bootstrap`, and `worker-connectivity` checks first.

### Quickstart: Codex adapter

Use this when a local Codex CLI should proxy the worker call.

1. Install and initialize:

```bash
npm i -g mcp-code-worker
cw init --preset=codex --allow-write
```

2. Persist the worker entry in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "codex-local",
      "provider": "codex",
      "model": "gpt-5.4",
      "clientCommand": "/path/to/codex",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
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

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "openai-compatible",
      "model": "<model>",
      "baseURL": "<base-url>",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Contracts:

- Generic:
  - [docs/provider-contracts/openai-compatible-generic.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/openai-compatible-generic.md)
- DeepSeek-specific:
  - [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)

### `claude-compatible`

Use `claude-compatible` when the upstream API is Claude / Anthropic native rather than OpenAI-compatible.

Typical settings:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "claude-compatible",
      "model": "<model>",
      "baseURL": "https://api.anthropic.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/claude-compatible.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claude-compatible.md)

### `litellm`

Use `litellm` when worker traffic should go through a LiteLLM gateway.

Typical settings:

```json
{
  "version": 2,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "litellm",
      "model": "<model>",
      "baseURL": "<gateway-base-url>",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/litellm.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/litellm.md)

### `client`

Use a local client provider when a compatible local CLI bridges the model calls.

- `sparkcode` is the default compatible command.
- Persist `clientCommand` on the matching `config.json.workers[]` entry whenever the default local client command differs from `sparkcode`.

Example:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "client",
      "model": "<model-name>",
      "clientCommand": "/path/to/compatible-client"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/local-client.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/local-client.md)

### `opencode`

Use `opencode` when worker traffic should go through the dedicated OpenCode adapter instead of the generic local client protocol.

- `opencode` uses `opencode run --format json` and parses the event stream directly.
- Persist `clientCommand` on the matching `config.json.workers[]` entry whenever the default command differs from `opencode`.

Example:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "opencode",
      "model": "deepseek/deepseek-v4-flash",
      "clientCommand": "/path/to/opencode",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/opencode.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/opencode.md)

### `claudecode`

Use `claudecode` when worker traffic should go through the dedicated Claude Code CLI adapter instead of the generic local client protocol or a hosted Anthropic-compatible API.

- `claudecode` uses `claude --print --output-format json` and reads Claude Code's structured JSON result.
- Persist `clientCommand` on the matching `config.json.workers[]` entry whenever the default command differs from `claude`.

Example:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "claudecode",
      "model": "sonnet",
      "clientCommand": "/path/to/claude"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/claudecode.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claudecode.md)

### `codex`

Use `codex` when worker traffic should go through the dedicated local Codex CLI adapter instead of the generic local client protocol or a hosted OpenAI-compatible API.

- `codex` uses `codex exec --json` and parses the event stream directly.
- Persist `clientCommand` on the matching `config.json.workers[]` entry whenever the default command differs from `codex`.

Example:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "codex",
      "model": "gpt-5.4",
      "clientCommand": "/path/to/codex"
    }
  ]
}
```

Contract:

- [docs/provider-contracts/codex.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/codex.md)

## Minimal Validation Flow

After changing provider configuration, run:

```bash
cw doctor
cw doctor --probe
cw worker list
```

If you are qualifying a real worker through the explicit advanced flow, continue with:

```bash
cw worker register --worker=<workerId> --provider=<provider> --model=<model> --allow-write
cw worker interview --worker=<workerId> --save
```

If coding qualification matters, then run:

```bash
cw worker benchmark --suite=coding-v1 --worker=<workerId> --save
```

Only use `--update-profile-capabilities` after reviewing the benchmark result explicitly.

## Troubleshooting Signals

Use these signals to narrow provider issues quickly:

- `cw doctor` reports missing or inconsistent worker model settings.
- `cw doctor --probe` shows whether the resolved worker can answer with the current runtime wiring.
- `cw worker interview --worker=<workerId> --save` returns provider invocation failures.
- `cw mcp serve` works but worker-routed tasks fail because the persisted worker config does not match the repo's active CW workspace.
- A local client provider fails because the selected `config.json.workers[]` entry points `clientCommand` at the wrong executable.

If provider invocation fails during interview, do not treat the resulting unavailable outcome as a completed onboarding result. Fix connectivity or auth first, then rerun the interview.

For provider-specific health checks and failure signatures, use the matching contract document:

- [Mock](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/mock.md)
- [OpenAI-compatible generic](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/openai-compatible-generic.md)
- [DeepSeek](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md)
- [Claude-compatible](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claude-compatible.md)
- [LiteLLM](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/litellm.md)
- [Local client](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/local-client.md)
- [Claude Code adapter](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/claudecode.md)
- [Codex adapter](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/codex.md)
- [OpenCode adapter](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/opencode.md)
