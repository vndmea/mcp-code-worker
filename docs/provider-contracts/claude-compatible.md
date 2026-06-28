# Claude-compatible Provider Contract

Use this document when the worker should call Anthropic Claude models through the Anthropic API shape.

## When To Use It

Use this contract when:

- the worker provider is `claude-compatible`
- or you use the accepted alias `anthropic`
- the upstream API is Claude / Anthropic native rather than OpenAI-compatible

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "claude-compatible",
    "model": "claude-3-5-sonnet-latest",
    "baseURL": "https://api.anthropic.com"
  }
}
```

Accepted provider strings:

- `claude-compatible`
- `anthropic`

## Required Environment Variables

Set the secret in the same runtime that launches `cw`:

PowerShell:

```powershell
$env:WORKER_MODEL_API_KEY="sk-ant-..."
```

bash:

```bash
export WORKER_MODEL_API_KEY="sk-ant-..."
```

`cw` keeps using the generic `WORKER_MODEL_API_KEY` env surface even though the upstream Anthropic SDK often defaults to `ANTHROPIC_API_KEY`.

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

If you validate the upstream API directly, compare it against the same runtime that launches `cw`.

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: `provider=claude-compatible` or `provider=anthropic`
- `worker-api-key`: `pass`
- `runtime-bootstrap`: confirms the active `config.json`, CW storage root, and launch env

Expected probe behavior:

- `worker-connectivity`: `pass`

If probe fails, read:

- `root-dir`
- `runtime-bootstrap`
- `worker-model`
- `worker-connectivity`

## Recommended Qualification Flow

```bash
cw worker register --provider claude-compatible --model claude-3-5-sonnet-latest --allow-write
cw worker interview --worker claude-compatible:claude-3-5-sonnet-latest --save
```

If coding qualification matters:

```bash
cw worker benchmark --suite coding-v1 --worker claude-compatible:claude-3-5-sonnet-latest --save
```

## Common Failure Signatures

- `401` / `403`
  - the API key is wrong or missing in the runtime that launches `cw`
- `404`
  - wrong base URL or model name
- probe fails while shell tests work
  - compare `runtime-bootstrap` and `worker-model` with the actual launcher environment
