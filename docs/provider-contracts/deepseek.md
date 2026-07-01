# DeepSeek Provider Contract

Use this document when qualifying DeepSeek through the `openai-compatible` worker path.

## When To Use It

Use this contract when:

- the worker provider is `openai-compatible`
- the upstream API is DeepSeek-compatible
- you want a concrete contract for `deepseek-v4-flash` or `deepseek-v4-pro`

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "deepseek-flash",
      "provider": "openai-compatible",
      "model": "deepseek-v4-flash",
      "baseURL": "https://api.deepseek.com"
    }
  ]
}
```

Supported shape:

- provider: `openai-compatible`
- primary base URL: `https://api.deepseek.com`
- compatibility base URL worth testing in some clients: `https://api.deepseek.com/v1`
- verified worker models in the 2026-06-26 internal trial:
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`

## Required Secret Configuration

Persist the provider key in the workspace SQLite store. The worker definition in `config.json` stays non-secret:

```json
{
  "version": 2,
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

## Minimal Health Checks

Before interview or benchmark, run:

```bash
cw doctor
cw doctor --probe
```

Direct API checks:

PowerShell:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "https://api.deepseek.com/models" `
  -Headers @{ Authorization = "Bearer <api-key>" }
```

curl:

```bash
curl https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Return JSON: {\"ok\":true}"}]
  }'
```

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: `provider=openai-compatible`, `model=deepseek-v4-flash`, `baseURL=https://api.deepseek.com`
- `worker-api-key`: `pass`
- `runtime-bootstrap`: confirms the active `config.json`, default CW storage path, and the resolved workspace root

Expected probe behavior:

- `worker-connectivity`: `pass` once the key, model, and base URL are correct

If probe fails, read these checks together:

- `root-dir`
- `runtime-bootstrap`
- `worker-model`
- `worker-connectivity`

## Recommended Registration And Qualification

Recommended registration:

```bash
cw worker register \
  --worker=deepseek-flash \
  --provider=openai-compatible \
  --model=deepseek-v4-flash \
  --base-url=https://api.deepseek.com \
  --allow-write
```

Qualification sequence:

1. Run `cw worker interview --worker=deepseek-flash --save`.
2. Run `cw worker benchmark --suite=coding-v1 --worker=deepseek-flash --save` when coding qualification matters.
3. Only use `--update-profile-capabilities` after the benchmark result is explicitly reviewed.

## Common Failure Signatures

- `Not Found`
  - test both documented base URLs
  - confirm the exact model name
- auth failures
  - verify the selected worker secret was persisted into SQLite
- provider invocation failures during interview
  - do not treat the unavailable result as a completed qualification
  - fix connectivity or auth first, then rerun

## Persisted Artifacts

By default, saved DeepSeek-related CW artifacts live under:

```text
~/.code-worker/<workspace-id>/
```

Expected persistence surfaces:

- `config.json`
- `data.db#worker_secrets`
- `data.db#worker_profiles`
- `data.db#worker_benchmarks`

The workspace SQLite store also holds task-session and audit artifacts when
those flows are exercised. Benchmark retention keeps only the latest saved row
per `(worker_id, suite_name)`.
