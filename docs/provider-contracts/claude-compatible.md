# Claude-compatible Provider Contract

Use this document when the worker should call Anthropic Claude models through the Anthropic API shape.

## When To Use It

Use this contract when:

- the worker provider is `claude-compatible`
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

## Required Environment Variables

Set the secret in the same runtime that launches `cw`:

Persist the provider key in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "apiKey": "sk-ant-..."
  }
}
```

`cw` stores the Anthropic-compatible key in the generic `workerModel.apiKey` field even though upstream tooling may document `ANTHROPIC_API_KEY`.

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

If you validate the upstream API directly, compare it against the same runtime that launches `cw`.

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: `provider=claude-compatible`
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
cw worker register --worker=claude-sonnet --provider=claude-compatible --model=claude-3-5-sonnet-latest --allow-write
cw worker interview --worker=claude-sonnet --save
```

If coding qualification matters:

```bash
cw worker benchmark --suite=coding-v1 --worker=claude-compatible:claude-3-5-sonnet-latest --save
```

## Common Failure Signatures

- `401` / `403`
  - the API key is wrong or missing in the runtime that launches `cw`
- `404`
  - wrong base URL or model name
- probe fails while shell tests work
  - compare `runtime-bootstrap` and `worker-model` with the actual launcher environment
