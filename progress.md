# Progress

## 2026-07-01

- Started breaking API worker refactor under file-based plan.
- Confirmed CodeGraph tools are unavailable in this session.
- Confirmed git worktree was clean before edits.
- Created phase plan following `opencode.md`.
- Completed Phase 1 code and tests for structured mode transparency.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm vitest run packages/models/src/structured/structured-invocation.test.ts packages/models/src/providers/ai-sdk-provider.test.ts packages/models/src/providers/litellm-provider.test.ts packages/models/src/providers/anthropic-provider.test.ts packages/graph/src/workers/worker-agent.test.ts packages/graph/src/workflows/patch-proposal-workflow.test.ts`
- Phase 2 is in progress: `ModelBehaviorProfile` registry.
- Completed Phase 2 code and tests for `ModelBehaviorProfile`.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm vitest run packages/models/src/profiles/model-behavior-profile.test.ts packages/models/src/router/worker-routing.test.ts packages/graph/src/workers/worker-agent.test.ts packages/graph/src/workflows/patch-proposal-workflow.test.ts`
- Phase 3 is in progress: worker contract backbone.
- Completed Phase 3 first backbone pass:
  - Core worker task/result envelopes.
  - Contract registry for review, summarization, codegen, validation-fix, test-generation, log-analysis, JSON extraction, and doc generation.
  - Thin worker adapters for the migrated non-patch workers.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm vitest run packages/core/src/schemas/worker-task-envelope.schema.test.ts packages/graph/src/contracts/worker-task-contract.test.ts packages/graph/src/workers/worker-agent.test.ts`
- Phase 4 is in progress: Codex host adapter and prompt builder.
- Completed Phase 4 first adapter pass:
  - Added `CodexHostAdapter`.
  - Connected `host-worker-workflow` to the adapter.
  - Added adapter test coverage.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm vitest run packages/graph/src/host/codex-host-adapter.test.ts packages/graph/src/workflows/workflow.test.ts`
- Phase 5 is in progress: semantic validator registry.
- Completed Phase 5 semantic validator registry:
  - Added `HostSemanticValidator` registry.
  - Moved host-worker review/context quality checks out of large workflow-local branches.
  - Added semantic statuses for `needs_more_context`, `blocked`, and `invalid_output`.
  - Added patch proposal and validation-claim semantic checks.
- Completed Phase 6 migration/deletion pass:
  - Moved patch-generation prompt/schema/fallback/mock response into `patch-generation-contract.ts`.
  - Replaced patch-generation worker-local invocation with a thin `WorkerAgent` adapter.
  - Registered `patch-generation` in the shared task contract registry.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm vitest run packages/graph/src/contracts/worker-task-contract.test.ts packages/graph/src/validators/host-semantic-validator.test.ts packages/graph/src/workflows/patch-proposal-workflow.test.ts packages/graph/src/workflows/workflow.test.ts packages/graph/src/workflows/workflow-output.test.ts`
  - `pnpm test`

## 2026-07-02

- Continued from the completed contract migration and focused on the remaining observability/persistence requirements from `opencode.md`.
- Confirmed CodeGraph-style tools were not available in this session and continued with scoped repository inspection.
- Completed Phase 7 observability persistence:
  - Added worker trust profile schema/types using roadmap trust levels.
  - Added worker execution record schema and SQLite storage.
  - Added `worker_task_executions`, `artifact_records`, and `cleanup_runs` schema tables.
  - Connected host-worker and patch-proposal workflows to execution recording and audit metadata.
  - Added core storage tests and workflow-level persistence tests.
- Rechecked OpenCode-copying risk by searching the official reference tree and project tree for the new execution/trust identifiers; matches were only in this project.
- Verification passed:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm vitest run packages/core/src/storage/worker-execution-store.test.ts packages/core/src/storage/sqlite.test.ts packages/core/src/schemas/worker-task-envelope.schema.test.ts packages/core/src/policies/storage-write-policy.test.ts packages/graph/src/workflows/workflow.test.ts packages/graph/src/workflows/patch-proposal-workflow.test.ts`
  - `pnpm test`
