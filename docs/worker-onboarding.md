# Worker Onboarding

Worker onboarding is the process of registering, evaluating, and approving a worker model before it is trusted with real tasks.

`mcp-code-worker` does not assume a worker is safe or capable just because an endpoint exists. A worker should be qualified explicitly and reviewed before production use.

> Warning:
> A weaker worker is not automatically a token-saving choice. If the host must still spend significant effort validating or rewriting the result, the combined cost can be higher than doing the work directly with the stronger model.
> Worker delegation is more likely to save tokens when the task is narrow, repetitive, low-risk, and easy to verify mechanically.

## Goals Of Onboarding

Onboarding establishes:

- whether the worker can follow instructions
- whether it returns structured JSON reliably
- whether it respects narrow repository scope
- whether it is safe to route production tasks through it
- whether it should remain not-qualified or qualified

## When A Worker Can Actually Save Tokens

Worker delegation is more likely to be efficient when the worker is used for:

- narrow file or symbol extraction
- structured field collection
- focused command execution and log capture
- small-scope summarization
- repetitive mechanical steps with clear acceptance criteria

It is less likely to save tokens when the worker is used for:

- final documentation writing
- architecture decisions
- complex code changes
- broad exploratory work that the host must re-check in full

## Basic Flow

Use this explicit advanced sequence for a new worker after `cw init`:

```bash
cw worker register \
  --worker=<workerId> \
  --provider=<provider> \
  --model=<model> \
  --base-url=<base-url-if-needed> \
  --allow-write

cw doctor --probe
cw worker interview --worker=<workerId> --save
cw worker readiness --worker=<workerId>
cw worker profile <workerId>
```

If the worker will be used for coding qualification or patch generation review, continue with:

```bash
cw worker benchmark --suite=coding-v1 --worker=<workerId> --save
cw worker readiness --worker=<workerId> --probe
```

Only after reviewing the benchmark result should you consider:

```bash
cw worker benchmark --suite=coding-v1 --worker=<workerId> --save --update-profile-capabilities
cw worker readiness --worker=<workerId>
```

## What The Interview Evaluates

The interview workflow checks:

- instruction following
- structured JSON output
- strict scope discipline
- summarization
- evidence-linked repository review
- refusal when mandatory evidence is missing
- code understanding
- simple TypeScript code generation
- confidence calibration

## Status Meanings

Interview output produces a `WorkerCapabilityProfile` that affects routing.

- `qualified`: the worker can receive the task types it qualified for
- `not-qualified`: the worker completed evaluation but should stay out of qualified task types

The profile status is not just descriptive. It changes how routing and policy checks behave.
Run `cw worker readiness --worker=<workerId>` for the separate runtime answer about whether that named worker is currently ready or unavailable for formal tasks.

## Persisted Artifacts

By default, onboarding-related state is stored under:

```text
~/.cw/workspaces/<workspace-id>/
```

Typical files include:

- `config.json`
- `workers.json`
- `worker-profiles.json`
- `worker-benchmarks/<sanitized-worker-id>/coding-v1.json`

`<sanitized-worker-id>` is the filesystem-safe form of the worker id.

## `--require-profile`

Use `--require-profile` when a task should fail instead of silently using an unqualified worker.

This is the safer option for:

- coding tasks
- review flows that matter for release decisions
- any workflow where host review expects a previously qualified worker profile

## Example: DeepSeek / OpenAI-compatible Worker

```bash
cw worker register \
  --worker=deepseek-flash \
  --provider=openai-compatible \
  --model=deepseek-v4-flash \
  --base-url=https://api.deepseek.com \
  --allow-write

cw worker interview --worker=deepseek-flash --save
cw worker benchmark --suite=coding-v1 --worker=deepseek-flash --save
```

See [docs/provider-contracts/deepseek.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/provider-contracts/deepseek.md) for provider-specific health checks and retry guidance.

## Example: LiteLLM Worker

```bash
cw worker register \
  --worker=qwen-local \
  --provider=litellm \
  --model=qwen3-coder \
  --base-url=http://localhost:4000/v1 \
  --allow-write

cw worker interview --worker=qwen-local --save
```

## Example: Claude Code Local Adapter

```bash
cw worker register \
  --worker=claudecode-local \
  --provider=claudecode \
  --model=sonnet \
  --allow-write

cw worker interview --worker=claudecode-local --save
cw worker readiness --worker=claudecode-local --probe
```

## Example: Codex Local Adapter

```bash
cw worker register \
  --worker=codex-local \
  --provider=codex \
  --model=gpt-5.4 \
  --allow-write

cw worker interview --worker=codex-local --save
cw worker readiness --worker=codex-local --probe
```

## Failure And Retry Guidance

Stop and fix the environment before retrying when:

- provider invocation fails during interview
- API key wiring is missing from the actual runtime
- the base URL or model name is wrong
- a local client provider or dedicated local adapter points to the wrong executable

Use `cw worker readiness --worker=<workerId> --probe` before a retry when you want a live connectivity probe for the exact named worker you plan to run.

Do not treat a provider-failure interview result as a completed qualification result.
