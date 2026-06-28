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
- `CW_ROOT_DIR`
- `CW_HOME_DIR`
- `CW_DRY_RUN`
- `CW_ALLOW_WRITE`
- `CW_ALLOWED_COMMANDS`

Runtime configuration resolves in this order:

1. CLI flags
2. Environment variables
3. `~/.cw/workspaces/<workspace-id>/config.json`
4. Built-in defaults

Do not store raw API keys in repository files or in persisted `config.json`. Provide secrets through environment variables such as `WORKER_MODEL_API_KEY`.

## Supported Provider Shapes

### `mock`

Use `mock` when you need deterministic local behavior without a real provider.

- Good for tests and local workflow validation.
- No API key is required.

### `openai-compatible`

Use `openai-compatible` for providers that expose an OpenAI-compatible API surface.

Typical settings:

```bash
WORKER_MODEL_PROVIDER=openai-compatible
WORKER_MODEL_NAME=<model>
WORKER_MODEL_BASE_URL=<base-url>
WORKER_MODEL_API_KEY=<secret>
```

For DeepSeek-specific guidance, see [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md).

### `litellm`

Use `litellm` when worker traffic should go through a LiteLLM gateway.

Typical settings:

```bash
WORKER_MODEL_PROVIDER=litellm
WORKER_MODEL_NAME=<model>
LITELLM_BASE_URL=<gateway-base-url>
```

If the worker should target a non-default endpoint, `WORKER_MODEL_BASE_URL` can still be used as the effective worker endpoint.

### `client` / `local-client`

Use a local client provider when a compatible local CLI bridges the model calls.

- `opencode` is the default compatible command.
- Persist `workerClientCommand` in `config.json` when the executable name or path differs.
- Use `CW_WORKER_CLIENT_COMMAND` only as a temporary runtime override.

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

## Minimal Validation Flow

After changing provider configuration, run:

```bash
cw doctor
cw worker list
```

If you are qualifying a real worker, continue with:

```bash
cw worker register --provider <provider> --model <model> --allow-write
cw worker interview --worker <workerId> --save
```

If coding qualification matters, then run:

```bash
cw worker benchmark --suite coding-v1 --worker <workerId> --save
```

Only use `--update-profile-capabilities` after reviewing the benchmark result explicitly.

## DeepSeek / OpenAI-compatible Health Checks

PowerShell:

```powershell
$env:WORKER_MODEL_API_KEY="..."

Invoke-RestMethod `
  -Method Get `
  -Uri "https://api.deepseek.com/models" `
  -Headers @{ Authorization = "Bearer $env:WORKER_MODEL_API_KEY" }
```

curl:

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $WORKER_MODEL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Return JSON: {\"ok\":true}"}]
  }'
```

If `Not Found` occurs, test both documented base URLs, confirm the exact model name, and verify that `WORKER_MODEL_API_KEY` is available in the same runtime that launches `cw`.

## Troubleshooting Signals

Use these signals to narrow provider issues quickly:

- `cw doctor` reports missing or inconsistent worker model settings.
- `cw worker interview --save` returns provider invocation failures.
- `cw mcp serve` works but worker-routed tasks fail because the MCP server environment does not contain the same provider variables as your shell.
- A local client provider fails because `workerClientCommand` or `CW_WORKER_CLIENT_COMMAND` points to the wrong executable, or an override is unnecessary.

If provider invocation fails during interview, do not treat the resulting blocked output as a completed onboarding result. Fix connectivity or auth first, then rerun the interview.
