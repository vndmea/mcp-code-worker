# Mock Provider Contract

Use this document when you need deterministic local validation without a real hosted provider.

## When To Use It

Use this contract when:

- provider is `mock`
- you want local workflow validation without network access
- you are verifying CLI, MCP, onboarding, or persistence paths before introducing a real provider

## Minimal Configuration

Persist:

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

## Required Environment Variables

None.

`mock` does not require a persisted worker secret.

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: `provider=mock`
- `worker-api-key`: `pass`
- `runtime-bootstrap`: points to the expected `config.json` and CW storage root

Expected probe behavior:

- `worker-connectivity`: `pass`

## Recommended Qualification Flow

Use `mock` for:

- local smoke validation
- setup verification
- MCP wiring verification

Interview is optional for basic local validation. Benchmark is usually unnecessary unless you specifically want to exercise the workflow.

## Common Failure Signatures

- probe fails under `mock`
  - treat this as a local runtime issue first, not a provider issue
  - inspect `runtime-bootstrap`, `worker-model`, and `worker-connectivity`
