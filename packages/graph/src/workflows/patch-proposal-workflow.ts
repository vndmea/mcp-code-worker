import {
  PatchInspectionSchema,
  type ExecutionContext,
  type PatchInspection,
  type PatchProposal,
  type RepositoryContextPack,
  type ValidationReport,
  resolveExecutionContext,
  writeAuditEvent
} from "@mcp-code-worker/core";
import {
  assessWorkerTaskEligibility,
  getPatchGenerationConsistencyIssue,
  resolveWorkerProfile
} from "@mcp-code-worker/models";
import {
  buildRepositoryContextPack,
  inspectPatch
} from "@mcp-code-worker/tools";

import {
  PatchGenerationWorker
} from "../workers/patch-generation-worker.js";
import { buildFallbackPatchProposal } from "../contracts/patch-generation-contract.js";
import {
  runHostSemanticValidation,
  type HostSemanticValidationResult
} from "../validators/host-semantic-validator.js";
import { resolveWorkflowWorkerContext } from "./worker-context-resolution.js";

export interface PatchProposalWorkflowInput {
  context?: ExecutionContext;
  errorLog?: string;
  fixResult?: unknown;
  goal?: string;
  repositoryContext?: RepositoryContextPack;
  requireProfile?: boolean;
  reviewResult?: unknown;
  scope?: string;
  validationReport?: ValidationReport;
  workerId?: string;
}

export interface PatchProposalWorkflowOutput {
  inspection: PatchInspection;
  proposal: PatchProposal;
  semanticValidation: HostSemanticValidationResult;
  warnings: string[];
}

export const PATCH_PLACEHOLDER_REASON =
  "Patch proposal is a fallback placeholder and must not be applied.";

const CORRUPT_PATCH_REASON_FRAGMENT = "corrupt patch";

const createPatchSemanticValidation = (input: {
  executionState: "blocked_by_policy" | "not_executed" | "executed";
  inspection: PatchInspection;
  proposal: PatchProposal;
  repositoryContext: RepositoryContextPack;
  validationReport?: ValidationReport;
}): HostSemanticValidationResult =>
  runHostSemanticValidation({
    executionState: input.executionState,
    patchInspection: input.inspection,
    patchProposal: input.proposal,
    repositoryContext: input.repositoryContext,
    requestedFiles: input.repositoryContext.requestedFiles,
    taskType: "patch-generation",
    validationReport: input.validationReport,
    workerResult: null
  });

export const isPlaceholderPatchProposal = (input: {
  inspection?: Pick<PatchInspection, "blockedReasons">;
  proposal?: Pick<PatchProposal, "title">;
  warnings?: string[];
}): boolean => {
  const title = input.proposal?.title ?? "";
  const blockedReasons = input.inspection?.blockedReasons ?? [];
  const warnings = input.warnings ?? [];

  return (
    title.includes("[PLACEHOLDER]") ||
    blockedReasons.includes(PATCH_PLACEHOLDER_REASON) ||
    warnings.includes(PATCH_PLACEHOLDER_REASON)
  );
};

const buildDeniedPatchProposalOutput = async (input: {
  context: ExecutionContext;
  fallbackProposal: PatchProposal;
  repositoryContext: RepositoryContextPack;
  reason: string;
  scope?: string;
  validationReport?: ValidationReport;
}): Promise<PatchProposalWorkflowOutput> => {
  const inspection = PatchInspectionSchema.parse({
    ...(await inspectPatch(input.context, input.fallbackProposal, {
      scope: input.scope
    })),
    ok: false,
    blockedReasons: [
      input.reason,
      PATCH_PLACEHOLDER_REASON
    ]
  });

  return {
    proposal: input.fallbackProposal,
    inspection,
    semanticValidation: createPatchSemanticValidation({
      executionState: "blocked_by_policy",
      inspection,
      proposal: input.fallbackProposal,
      repositoryContext: input.repositoryContext,
      validationReport: input.validationReport
    }),
    warnings: [input.reason]
  };
};

const hasCorruptPatchReason = (inspection: PatchInspection): boolean =>
  inspection.blockedReasons.some((reason) =>
    reason.toLowerCase().includes(CORRUPT_PATCH_REASON_FRAGMENT)
  );

export const runPatchProposalWorkflow = async (
  input: PatchProposalWorkflowInput
): Promise<PatchProposalWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const repositoryContext =
    input.repositoryContext ??
    await buildRepositoryContextPack(context, {
      rootDir: context.rootDir,
      scope: input.scope,
      errorLog: input.errorLog
    });
  const effectiveScope = repositoryContext.scope ?? input.scope;
  const warnings: string[] = [];
  const resolvedWorker = await resolveWorkflowWorkerContext({
    activity: "patch proposal generation",
    context,
    workerId: input.workerId
  });
  const workerContext = resolvedWorker.context;
  const workerId = resolvedWorker.workerId;
  const workerProfileResolution = await resolveWorkerProfile({
    context: workerContext,
    modelConfig: workerContext.workerModel,
    workerId,
    requireProfile: input.requireProfile
  });
  const fallbackProposal = buildFallbackPatchProposal(
    {
      goal: input.goal,
      scope: effectiveScope
    },
    repositoryContext,
    workerId
  );
  const workerProfile = workerProfileResolution?.profile;
  const patchEligibility = workerProfile
    ? assessWorkerTaskEligibility(workerProfile, "patch-generation")
    : null;
  const routedWorkerProfile = patchEligibility?.allowed ? workerProfile : null;

  if (workerProfile) {
    const patchGenerationConsistencyIssue =
      getPatchGenerationConsistencyIssue(workerProfile);

    if (patchGenerationConsistencyIssue) {
      return buildDeniedPatchProposalOutput({
        context,
        fallbackProposal,
        repositoryContext,
        reason:
          `${patchGenerationConsistencyIssue} Re-run 'cw worker benchmark --worker ${workerProfile.workerId} --suite coding-v1 --save --update-profile-capabilities'.`,
        scope: effectiveScope,
        validationReport: input.validationReport
      });
    }

    if (patchEligibility && !patchEligibility.allowed) {
      return buildDeniedPatchProposalOutput({
        context,
        fallbackProposal,
        repositoryContext,
        reason: patchEligibility.reason,
        scope: effectiveScope,
        validationReport: input.validationReport
      });
    }
  }

  const patchWorker = new PatchGenerationWorker(workerContext);
  const generation = await patchWorker.generateProposal({
    errorLog: input.errorLog,
    fixResult: input.fixResult,
    goal: input.goal ?? "Propose a safe patch.",
    repositoryContext,
    reviewResult: input.reviewResult,
    scope: effectiveScope,
    validationReport: input.validationReport,
    workerId,
    workerProfile: routedWorkerProfile
  });
  let proposal = generation.proposal;
  let inspection = await inspectPatch(context, proposal, {
    scope: effectiveScope
  });

  if (!generation.structuredOutputOk) {
    warnings.push(PATCH_PLACEHOLDER_REASON);
    inspection = PatchInspectionSchema.parse({
      ...inspection,
      ok: false,
      blockedReasons: [
        PATCH_PLACEHOLDER_REASON,
        ...inspection.blockedReasons,
        ...generation.errors
      ]
    });
  }

  if (generation.structuredOutputOk && !inspection.ok && hasCorruptPatchReason(inspection)) {
    const denied = await buildDeniedPatchProposalOutput({
      context,
      fallbackProposal,
      repositoryContext,
      reason: "Structured patch output produced a corrupt unified diff.",
      scope: effectiveScope,
      validationReport: input.validationReport
    });

    proposal = denied.proposal;
    inspection = PatchInspectionSchema.parse({
      ...denied.inspection,
      blockedReasons: [
        ...denied.inspection.blockedReasons,
        ...inspection.blockedReasons
      ]
    });
    warnings.push("Structured patch output produced a corrupt unified diff.");
  }

  const semanticValidation = createPatchSemanticValidation({
    executionState: generation.structuredOutputOk ? "executed" : "not_executed",
    inspection,
    proposal,
    repositoryContext,
    validationReport: input.validationReport
  });

  if (semanticValidation.issues.length > 0) {
    const semanticReasons = semanticValidation.issues.map((issue) => issue.reason);
    inspection = PatchInspectionSchema.parse({
      ...inspection,
      ok: false,
      blockedReasons: [
        ...inspection.blockedReasons,
        ...semanticReasons
      ]
    });
    warnings.push(...semanticReasons);
  }

  await writeAuditEvent(context, {
    actor: "workflow",
    action: "propose-patch",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "patch-proposal-workflow",
    inputSummary: input.goal ?? input.scope ?? "patch proposal",
    outputSummary: inspection.ok
      ? "Patch proposal generated."
      : "Patch proposal generated but inspection blocked it.",
    warnings,
    errors: inspection.blockedReasons,
    metadata: {
      patchId: proposal.id,
      semanticResultStatus: semanticValidation.resultStatus,
      scope: effectiveScope,
      workerId
    }
  });

  return {
    proposal,
    inspection,
    semanticValidation,
    warnings
  };
};
