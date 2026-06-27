# DeepSeek Provider Contract

Use this document when qualifying DeepSeek through the OpenAI-compatible worker path.

## Supported Shape

- Provider: `openai-compatible`
- API key env var: `WORKER_MODEL_API_KEY`
- Primary base URL: `https://api.deepseek.com`
- Compatibility base URL worth testing in some clients: `https://api.deepseek.com/v1`
- Verified worker models in the 2026-06-26 internal trial: `deepseek-v4-flash`, `deepseek-v4-pro`

## Recommended Registration

```bash
pnpm exec ao worker register \
  --worker openai-compatible:deepseek-v4-flash \
  --provider openai-compatible \
  --model deepseek-v4-flash \
  --base-url https://api.deepseek.com \
  --allow-write
```

## Qualification Sequence

1. Run `pnpm exec ao worker interview --worker openai-compatible:deepseek-v4-flash --save`.
2. Run `pnpm exec ao worker benchmark --suite coding-v1 --worker openai-compatible:deepseek-v4-flash --save`.
3. Only use `--update-profile-capabilities` after the benchmark result is explicitly reviewed.

## Expected Persisted Artifacts

By default, saved DeepSeek-related AO artifacts live under:

```text
~/.ao/workspaces/<workspace-id>/
```

Expected files:

- `workers.json`
- `worker-profiles.json`
- `worker-benchmarks/<sanitized-worker-id>/coding-v1.json`

`<sanitized-worker-id>` is the filesystem-safe form of the worker id. Example:

- worker id: `openai-compatible:deepseek-v4-flash`
- persisted path segment: `openai-compatible_deepseek-v4-flash`

## Health Checks

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

## Common Failure Modes

- `Not Found`: test both documented base URLs and confirm the exact model name.
- auth failures: verify `WORKER_MODEL_API_KEY` is actually populated in the current shell or MCP server environment.
- provider invocation failures during interview: do not treat the resulting blocked output as a completed qualification. Re-run after fixing provider access.

## Retry Guidance

- Retry registration only when provider, model name, or base URL changed.
- Retry interview after fixing connectivity, auth, or model naming problems.
- Retry benchmark only after interview has succeeded and the saved profile is visible.
- Do not promote `patch-generation` until benchmark evidence has been reviewed by a human.
