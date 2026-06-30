# Codex Adapter

Use this document when `cw` should proxy worker calls through the dedicated local Codex CLI adapter instead of a hosted HTTP API or the generic local client contract.

## When To Use It

Use this contract when:

- provider is `codex`
- the worker should run through a local `codex` / `codex.exe` command
- you want the dedicated Codex CLI adapter instead of `provider=client`

## Runtime Contract

`codex` currently uses the Codex non-interactive JSON event surface:

- command shape: `codex exec --json`
- optional schema path: `--output-schema <file>`
- default command: `codex`
- prompt transport: stdin

## Minimal Configuration

Persist the non-secret defaults in `config.json`:

```json
{
  "version": 1,
  "workerModel": {
    "provider": "codex",
    "model": "gpt-5.4"
  },
  "workerClientCommand": "/path/to/codex"
}
```

If the executable is already available as `codex` on `PATH`, `workerClientCommand` can be omitted.

## Required Environment Variables

No API key is required by `cw` for `codex` providers.

You may still need Codex to be authenticated locally through its own supported auth flow.

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

- `worker-model`: shows `provider=codex`
- `worker-api-key`: `pass`
- `local-client-command`: `pass`
- `local-client-compatibility`: `pass`

Expected probe behavior:

- `worker-connectivity`: `pass` when Codex launches and can answer a short probe

## Recommended Qualification Flow

```bash
cw worker register --worker=codex-local --provider=codex --model=gpt-5.4 --allow-write
cw worker interview --worker=codex-local --save
cw worker readiness --worker=codex-local --probe
cw worker benchmark --suite=coding-v1 --worker=codex-local --save
cw worker benchmark --suite=coding-v1 --worker=codex-local --save --update-profile-capabilities
```

## Common Failure Signatures

- command not found
  - `workerClientCommand` is wrong
  - the executable is not on `PATH`
- compatibility check fails
  - the executable exists but does not expose the expected `codex exec` surface
- probe fails after compatibility passes
  - Codex launches but cannot complete the actual model call
  - local Codex auth is missing, expired, or tied to the wrong environment

## Notes

- `codex` is separate from `openai-compatible`
- `openai-compatible` is for OpenAI-compatible HTTP APIs
- `codex` is for the local Codex CLI adapter
