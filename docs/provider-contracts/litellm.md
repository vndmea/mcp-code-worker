# LiteLLM Provider Contract

Use this document when worker traffic should go through a LiteLLM gateway.

## When To Use It

Use this contract when:

- the worker provider is `litellm`
- you want a gateway layer between `cw` and one or more upstream model providers
- the gateway, not `cw`, owns the upstream routing details

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "litellm",
      "model": "<gateway-model-name>"
    }
  ]
}
```

Then provide the gateway URL:

Persist the LiteLLM gateway settings in `config.json`, and persist any gateway secret in the workspace SQLite store:

```json
{
  "version": 2,
  "workers": [
    {
      "workerId": "<workerId>",
      "provider": "litellm",
      "model": "<gateway-model-name>",
      "baseURL": "https://litellm.example.com",
      "enabled": true,
      "tags": [],
      "createdAt": "2026-07-01T00:00:00.000Z",
      "updatedAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

## Required Config Fields

- `baseURL` on the selected `config.json.workers[]` entry
- any gateway-side secret persisted for that worker in the workspace SQLite store

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

Also verify the gateway itself responds before debugging worker qualification.

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: shows `provider=litellm`
- `runtime-bootstrap`: points to the expected `config.json` and CW storage root

Expected probe behavior:

- `worker-connectivity`: `pass` when the gateway URL and model mapping are valid

If probe fails, read:

- `runtime-bootstrap`
- `worker-model`
- `worker-connectivity`

## Recommended Qualification Flow

```bash
cw worker register --worker=<workerId> --provider=litellm --model=<gateway-model-name> --allow-write
cw worker interview --worker=<workerId> --save
```

Benchmark only after interview succeeds.

## Common Failure Signatures

- gateway `404`
  - wrong `baseURL` on the selected `config.json.workers[]` entry
- gateway model not found
  - wrong LiteLLM routing model name
- probe fails intermittently
  - verify gateway health first before re-running qualification
