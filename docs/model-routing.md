# Model Routing

CW keeps two separate concepts:

- worker model defaults come from user-scoped config or environment variables
- worker execution targets come from explicit named worker registrations plus an explicit `workerId`

This means provider/model/base URL defaults still exist, but task execution no longer guesses which worker to run. Every worker execution flow now expects a registered worker name such as `--worker qwen-local`.

- In host-driven setups, the host keeps planning, decomposition, review, and final decisions.
- CW worker models handle summarization, draft generation, extraction, and repetitive tasks.
- Mock providers are the runtime default so tests run without real credentials.
- LiteLLM is supported through an OpenAI-compatible endpoint configuration.
- Worker model config surfaces remain `WORKER_MODEL_PROVIDER`, `WORKER_MODEL_NAME`, `WORKER_MODEL_BASE_URL`, and `WORKER_MODEL_API_KEY`.
- Worker execution is gated by both named registration and `WorkerCapabilityProfile`, not only by provider/model availability.
- Newly connected workers should pass onboarding evaluation before they receive production tasks.
- Limited workers are restricted to qualified low-risk task types, and not-qualified workers are excluded from task types they did not qualify for.
