# mcp-code-worker API Worker Refactor Plan

## Goal

Refactor the API worker path into a host-owned contract execution chain, following `C:\Users\fanwenzhong\Desktop\opencode.md`.

This is a breaking refactor. Do not preserve old worker execution paths for compatibility once a new path covers the target behavior.

## Guardrails

- First phase targets API models and `host=codex`.
- Do not clone OpenCode. Borrow only agent specialization, rules injection, permission boundary, model-specific behavior, and validation-loop ideas.
- Keep task contract, model behavior, host adapter, semantic validation, and persistence responsibilities separated.
- Before each phase, check whether logic is being reused or whether a new side path is being created.
- Tests follow the new mainline. Skip or remove obsolete old-mainline expectations instead of bending the new design around them.

## Phases

### Phase 1: Structured Mode Transparency

Status: complete

Deliverables:
- `ModelInvocationResult` reports actual structured output mode.
- Native structured output fallback is visible to callers.
- `invokeStructured` returns structured mode metadata.
- Worker debug metadata includes structured mode.
- Focused tests cover native and prompt-only JSON modes.

Verification:
- `pnpm vitest run packages/models/src/structured/structured-invocation.test.ts packages/models/src/providers/ai-sdk-provider.test.ts packages/models/src/providers/litellm-provider.test.ts`
- Targeted graph worker tests if metadata contracts change.

### Phase 2: Model Behavior Profile Registry

Status: complete

Deliverables:
- Add `ModelBehaviorProfile` / registry as the single source for provider/model JSON strategy, temperature guidance, repair policy, and allowed task types.
- Stop adding model-specific behavior as provider/workflow branches.

Verification:
- Unit tests for default, DeepSeek-like, Qwen-like, and Kimi-like profiles.

### Phase 3: Worker Contract Backbone

Status: complete

Deliverables:
- Add `WorkerTaskEnvelope`, `WorkerResultEnvelope`, and `TaskContractRegistry`.
- Move at least review-lite, summarization, codegen, and test-generation schemas/prompts into registry-backed contracts.

Verification:
- Contract registry tests.
- Existing worker tests updated to assert contract-driven flow.

### Phase 4: Codex Host Adapter and Prompt Builder

Status: complete

Deliverables:
- Add `CodexHostAdapter` and shared `WorkerPromptBuilder`.
- Host/repo rules injection is adapter-owned, not duplicated in worker classes.

Verification:
- Prompt builder snapshot/shape tests.
- Host-worker workflow still reports selected files and prompt transparency.

### Phase 5: Semantic Validator Registry

Status: complete

Deliverables:
- Add registered `HostSemanticValidator` entry point.
- Move host quality checks out of large workflow branches.
- Cover review, patch proposal, test failure analysis style validations.

Verification:
- Tests cover out-of-scope review references, out-of-context patch files, fabricated validation claims, `needs_more_context`, and `blocked`.

### Phase 6: Migration and Deletion

Status: complete

Deliverables:
- Migrate patch generation to the shared contract path.
- Delete replaced worker-local schemas, prompts, repair/fallback logic.
- Update or remove old tests that force discarded behavior.

Verification:
- `pnpm typecheck`
- `pnpm test`
- Focused workflow tests for host-worker and patch proposal flows.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| CodeGraph tools unavailable | Initial exploration | Continue with scoped `rg` and direct source reads. |
| Required `structuredOutputMode` broke old test fixtures | Phase 1 typecheck | Kept production field required and upgraded test fixtures/helpers instead of weakening the contract. |
| `reviewTaskTypes.includes(...)` was too narrow for `WorkerTaskType` | Phase 5 typecheck | Switched to `some(...)` narrowing and kept the registry type broad enough for patch-generation validators. |
| `PatchProposalWorkflowOutput` required semantic validation in older output tests | Phase 5 typecheck | Updated the fixture to include `semanticValidation` instead of making the field optional. |
