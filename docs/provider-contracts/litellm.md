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
  "workerModel": {
    "provider": "litellm",
    "model": "<gateway-model-name>"
  }
}
```

Then provide the gateway URL:

PowerShell:

```powershell
$env:LITELLM_BASE_URL="https://litellm.example.com"
```

bash:

```bash
export LITELLM_BASE_URL="https://litellm.example.com"
```

If you use `WORKER_MODEL_BASE_URL`, it becomes the effective worker endpoint instead of the default LiteLLM base URL.

## Required Environment Variables

- `LITELLM_BASE_URL`
- any gateway-side secret that the LiteLLM deployment expects in the same runtime as `cw`

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
cw worker register --provider litellm --model <gateway-model-name> --allow-write
cw worker interview --worker litellm:<gateway-model-name> --save
```

Benchmark only after interview succeeds.

## Common Failure Signatures

- gateway `404`
  - wrong `LITELLM_BASE_URL`
- gateway model not found
  - wrong LiteLLM routing model name
- probe fails intermittently
  - verify gateway health first before re-running qualification
