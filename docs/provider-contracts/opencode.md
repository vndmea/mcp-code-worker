# OpenCode Provider Contract

Use this document when `cw` should proxy worker calls through the dedicated OpenCode adapter instead of a hosted HTTP API or the generic local client contract.

## When To Use It

Use this contract when:

- provider is `opencode`
- `cw` should call `opencode run --format json`
- the OpenCode executable is local to the machine where `cw` runs

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "opencode-local",
      "provider": "opencode",
      "model": "deepseek/deepseek-v4-flash",
      "clientCommand": "/path/to/opencode"
    }
  ]
}
```

Notes:

- `opencode` is the default command
- use `clientCommand` on the selected `config.json.workers[]` entry as the persisted override
- the persisted `config.json.workers[]` entry is authoritative for the worker model id
- if your local OpenCode default model changes, refresh or re-register the matching `opencode-local` entry so it does not keep pointing at an older model such as `sudocode/gpt-5.4`

## Model Resolution Priority

When `cw` resolves an `opencode` worker, the effective model comes from this order:

1. the named worker entry in `config.json.workers[]`
2. only then the local OpenCode default model from `opencode.json`

That means changing OpenCode's own default model does not automatically rewrite an existing `cw` worker registration.

If these disagree, current `cw doctor` now emits a warning that includes:

- the registered worker model
- the local OpenCode default model
- the local OpenCode config path

Fix by either:

- re-registering the worker with the new model
- or updating the existing `config.json.workers[]` registration intentionally

## Required Environment Variables

No API key is required by `cw` for `opencode` providers.

You may still need upstream secrets if the OpenCode runtime itself expects them.

## Minimal Health Checks

Run:

```bash
cw doctor
cw doctor --probe
```

The static local client checks matter before probe:

- `local-client-command`
- `local-client-compatibility`

## Expected `cw doctor` / `cw doctor --probe` Signals

Expected static checks:

- `worker-model`: shows `provider=opencode`
- `worker-api-key`: `pass`
- `local-client-command`: `pass`
- `local-client-compatibility`: `pass`

Expected probe behavior:

- `worker-connectivity`: `pass` when OpenCode launches and can answer a short probe

If probe fails, read:

- `runtime-bootstrap`
- `local-client-command`
- `local-client-compatibility`
- `worker-connectivity`

## Recommended Qualification Flow

```bash
cw worker register --worker=opencode-local --provider=opencode --model=deepseek/deepseek-v4-flash --allow-write
cw worker interview --worker=opencode-local --save
```

Benchmark only after compatibility and interview both succeed.

## Common Failure Signatures

- command not found
  - the selected `config.json.workers[]` entry has the wrong `clientCommand`
  - the executable is not on `PATH`
- compatibility check fails
  - the executable exists but does not expose the expected `opencode run` surface
- probe fails after compatibility passes
  - OpenCode launches but cannot complete the actual model call
