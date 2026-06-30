# OpenAI-compatible Provider Contract

Use this document when the upstream provider exposes an OpenAI-compatible API but is not DeepSeek-specific.

## When To Use It

Use this contract when:

- the worker provider is `openai-compatible`
- the upstream API accepts an OpenAI-compatible chat/completions shape
- you want the generic contract instead of a provider-specific one

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "openai-compatible",
      "model": "<model-name>",
      "baseURL": "https://provider.example.com"
    }
  ]
}
```

Expected shape:

- provider: `openai-compatible`
- model: upstream model name
- base URL: the provider's OpenAI-compatible API root

## Required Config Fields

Persist the provider key in the workspace SQLite store. The worker definition in `config.json` stays non-secret:

```json
{
  "version": 2,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "openai-compatible",
      "model": "<model-name>",
      "baseURL": "https://provider.example.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

If the provider documents a `/models` endpoint, test it directly with the same key and base URL before assuming `cw` is at fault.

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: shows `provider=openai-compatible`
- `worker-api-key`: `pass`
- `runtime-bootstrap`: points to the expected `config.json` and CW storage root

Expected probe behavior:

- `worker-connectivity`: `pass` when the base URL, model, and key are valid

If probe fails, read:

- `root-dir`
- `runtime-bootstrap`
- `worker-model`
- `worker-connectivity`

## Recommended Qualification Flow

Use the generic flow:

```bash
cw worker register --worker=<workerId> --provider=openai-compatible --model=<model-name> --allow-write
cw worker interview --worker=<workerId> --save
```

If coding qualification matters:

```bash
cw worker benchmark --suite=coding-v1 --worker=openai-compatible:<model-name> --save
```

## Common Failure Signatures

- `401` / `403`
  - invalid or missing worker secret in the workspace SQLite store
- `404` / `Not Found`
  - wrong base URL or wrong model name
- probe fails but direct shell API call works
  - compare `cw doctor --probe` output with the runtime that actually launches `cw`
  - inspect `runtime-bootstrap` and `worker-model`
