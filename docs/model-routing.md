# Model Routing

CW keeps two separate concepts:

- worker model defaults come from user-scoped config, while launch identity metadata remains limited to process-level diagnostics
- worker execution targets come from explicit named worker registrations plus an explicit `workerId`

This means provider/model/base URL defaults still exist, but task execution no longer guesses which worker to run. Every worker execution flow now expects a registered worker name such as `--worker=qwen-local`.

- In host-driven setups, the host keeps planning, decomposition, review, and final decisions.
- CW worker models handle summarization, draft generation, extraction, and repetitive tasks.
- Mock providers are the runtime default so tests run without real credentials.
- `openai-compatible` and `claude-compatible` are API-protocol provider families, not brand-specific adapters.
- LiteLLM is supported through an OpenAI-compatible endpoint configuration.
- `client`, `opencode`, `claudecode`, and `codex` are local CLI adapter paths with separate runtime contracts.
- Worker model config lives in user-scoped `config.json` under `workerModel`.
- Worker execution is gated by both named registration and `WorkerCapabilityProfile`, not only by provider/model availability.
- Newly connected workers should pass onboarding evaluation before they receive production tasks.
- Limited workers are restricted to qualified low-risk task types, and not-qualified workers are excluded from task types they did not qualify for.
