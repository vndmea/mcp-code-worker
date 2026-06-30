# Local Client Provider Contract

Use this document when `cw` should proxy worker calls through a compatible local CLI instead of a hosted HTTP API.

## When To Use It

Use this contract when:

- provider is `client`
- a compatible local executable should bridge the model call
- the bridge command is local to the machine where `cw` runs

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "client",
    "model": "qwen3-coder"
  },
  "workerClientCommand": "/path/to/compatible-client"
}
```

Notes:

- `opencode` is the default compatible command
- use `workerClientCommand` in `config.json` as the primary persisted override

## Required Environment Variables

No API key is required by `cw` for `client` providers.

You may still need upstream secrets if the compatible local client itself expects them.

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

- `worker-model`: shows `provider=client`
- `worker-api-key`: `pass`
- `local-client-command`: `pass`
- `local-client-compatibility`: `pass`

Expected probe behavior:

- `worker-connectivity`: `pass` when the compatible client launches and can answer a short probe

If probe fails, read:

- `runtime-bootstrap`
- `local-client-command`
- `local-client-compatibility`
- `worker-connectivity`

## Recommended Qualification Flow

```bash
cw worker register --worker=sparkcode-local --provider=client --model=qwen3-coder --allow-write
cw worker interview --worker=sparkcode-local --save
```

Benchmark only after compatibility and interview both succeed.

## Common Failure Signatures

- command not found
  - `workerClientCommand` is wrong
  - the executable is not on `PATH`
- compatibility check fails
  - the executable exists but does not look like the expected bridge client
- probe fails after compatibility passes
  - the client launches but cannot complete the actual model call
