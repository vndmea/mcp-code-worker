# Findings

## OpenCode Reference

- Official OpenCode source checked at `tmp/opencode-official`, commit `6697cf3fd81d44fc8c3f72d32edb0e2549d24003`.
- Relevant borrowed ideas:
  - Agent info contains prompt, model, temperature/topP, options, and permission rules.
  - Session injects project/global instructions and MCP instructions before model calls.
  - Structured output is enforced as an explicit final tool in JSON-schema mode.
  - Tools are enabled/disabled through merged permission rules.
- Explicit non-goals:
  - Do not copy OpenCode UI.
  - Do not adopt its full session/tool system.
  - Do not make local OpenCode provider the first-phase path.

## Current Repository State

- `packages/models/src/structured/structured-invocation.ts` already centralizes parse, Zod validation, and repair retry.
- `packages/models/src/providers/ai-sdk-provider.ts` and `litellm-provider.ts` silently fall back from native structured output to plain text generation when schema response format is unsupported.
- `ModelInvocationResult` currently lacks an actual structured mode field.
- Worker schemas/prompts are still owned by individual workers:
  - `review-worker.ts`
  - `summarize-worker.ts`
  - `codegen-worker.ts`
  - `test-worker.ts`
  - `patch-generation-worker.ts`
- `patch-generation-worker.ts` bypasses `WorkerAgent` and calls `invokeStructured` directly.
- `host-worker-workflow.ts` contains useful semantic quality gates, but they are embedded in workflow logic rather than registered validators.
- SQLite has profiles, benchmarks, task sessions, artifacts, and audit events, but no dedicated contract execution record yet.

## First Cut Decision

Start with structured mode transparency because it is the smallest shared foundation and directly addresses DeepSeek/Qwen/Kimi debugging. This avoids prematurely migrating workers before the invocation layer can report what actually happened.

## Phase 1 Result

- `ModelInvocationResult` now requires `structuredOutputMode`.
- API providers report `native-json-schema` when schema-native output succeeds.
- API providers report `prompt-only-json` and `structuredOutputFallbackReason` when native schema output is unsupported and fallback text generation is used.
- Worker metadata and `worker-debug.json` now expose structured output mode.
- This reused the existing `invokeStructured` path and did not introduce a parallel invocation chain.

## Phase 2 Result

- Added `ModelBehaviorProfile` registry under `packages/models/src/profiles`.
- Registered Codex, local client, Claude Code, OpenCode, DeepSeek, Qwen, Kimi/Moonshot, and default API profiles.
- `ModelRouter.route()` now returns the resolved behavior profile.
- Workers use the routed profile repair-attempt policy and expose the profile id in metadata.
- Model-specific differences now have a single source instead of growing provider/workflow branches.

## Phase 3 Result

- Added `WorkerTaskEnvelopeSchema` and `WorkerResultEnvelopeSchema` in core.
- Added graph-level `WorkerTaskContract` registry for first-phase non-patch worker tasks.
- Review, summarize, codegen, and test workers are now thin adapters over the contract registry.
- Worker-local schema/prompt/fallback duplication was removed for those workers.
- Patch generation remains the only worker-local contract path and is intentionally left for the later migration/deletion phase.

## Phase 4 Result

- Added `CodexHostAdapter` under `packages/graph/src/host`.
- `host-worker-workflow` now obtains the worker task, planned task, and prompt transformation through the adapter.
- The adapter builds a `WorkerTaskEnvelope` and bridges it into the existing `AgentTask` input while the older workflow surface remains under active migration.
- Prompt transformation is now host-adapter-owned instead of hardcoded at the workflow return site.
- No multi-host abstraction was added; only `host=codex` is implemented.

## Phase 5 Result

- Added `HostSemanticValidator` registry under `packages/graph/src/validators`.
- `host-worker-workflow` now aggregates semantic validation results instead of owning task-specific review branches.
- Review validators cover missing answer, missing selected-file references, missing per-finding citations, and out-of-scope file references.
- General validators cover missing requested files, context gaps, generic/template fallbacks, and unsupported validation-pass claims.
- Patch validators cover out-of-context patch files, placeholder proposals, unsupported validation claims, and inspection-blocked patches.
- Semantic validation now returns a controlled `WorkerResultStatus` (`ok`, `needs_more_context`, `blocked`, `invalid_output`, `host_takeover`) for host decisions and debug output.

## Phase 6 Result

- Migrated patch generation into the shared `WorkerTaskContract` registry through `patch-generation-contract.ts`.
- Replaced the old patch worker-local invocation path with a thin `PatchGenerationWorker` adapter over `WorkerAgent`.
- Patch schema, prompt, fallback, mock response, and patch-context prompt construction now live in the contract layer.
- `patch-proposal-workflow` still owns policy gating, patch inspection, and host semantic aggregation, but no longer owns the patch prompt/schema path.
- Full repository tests pass after the migration, confirming the change did not create a side execution path.

## Phase 7 Result

- Added `WorkerTrustProfile` with the `unknown`, `interviewed`, `benchmarked`, and `verified` trust levels described by the roadmap.
- Added `WorkerTaskExecutionRecord` and a SQLite-backed `worker_task_executions` store for host-owned contract execution metadata.
- Added `artifact_records` and `cleanup_runs` tables as the persistence boundary for execution artifacts and future retention cleanup.
- `host-worker-workflow` and `patch-proposal-workflow` now record task envelope, result envelope, trust profile, structured output diagnostics, semantic status, and artifact references.
- Execution records reuse the existing storage write policy: dry-run remains preview-only, execute mode persists records and artifact references.
- Patch generation continues to flow through `CodexHostAdapter` and the shared contract registry instead of creating a second patch-specific contract path.
- OpenCode source was used only as a conceptual reference. No bulk OpenCode source was copied into this implementation.

## Final Refactor Assessment

- `TaskContractRegistry` remains the task protocol source of truth for migrated worker tasks, including patch generation.
- `ModelBehaviorProfileRegistry` remains the model behavior source of truth for structured output strategy and repair policy.
- Host rules and prompt transformation remain adapter-owned through `CodexHostAdapter`.
- Semantic rejection remains validator-owned rather than scattered as task-local parsing logic.
- Persistence is centralized in core storage instead of writing ad hoc workflow files.
- Remaining workflow branches are policy, context selection, patch inspection, audit, and orchestration boundaries rather than duplicated parser/repair/prompt implementations.
