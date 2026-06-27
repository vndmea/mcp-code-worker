# Model Routing

AO resolves one default worker model from environment variables or user-scoped config.

- In host-driven setups, the host keeps planning, decomposition, review, and final decisions.
- AO worker models handle summarization, draft generation, extraction, and repetitive tasks.
- Mock providers are the default so tests run without real credentials.
- LiteLLM is supported through an OpenAI-compatible endpoint configuration.
- The default worker config surface is `WORKER_MODEL_PROVIDER`, `WORKER_MODEL_NAME`, `WORKER_MODEL_BASE_URL`, and `WORKER_MODEL_API_KEY`.
- Worker routing is gated by `WorkerCapabilityProfile`, not only by provider/model availability.
- Newly connected workers should pass onboarding evaluation before they receive production tasks.
- Limited workers are restricted to qualified low-risk task types, and blocked workers are excluded entirely.
