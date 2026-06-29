import {
  createExecutionContextWithWorkerModel,
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
  requireConfiguredWorkerId,
  resolveWorkerTarget,
  resolveWorkerProfile
} from "@mcp-code-worker/models";
import {
  buildRepositoryContextPack,
  inspectPatch
} from "@mcp-code-worker/tools";

import {
  buildFallbackPatchProposal,
  PatchGenerationWorker
} from "../workers/patch-generation-worker.js";

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
  warnings: string[];
}

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
  const requestedWorkerId = requireConfiguredWorkerId(
    context,
    input.workerId,
    "patch proposal generation"
  );
  const workerModelResolution = await resolveWorkerTarget({
    context,
    workerId: requestedWorkerId
  });
  const workerContext = createExecutionContextWithWorkerModel(
    context,
    workerModelResolution.modelConfig
  );
  const workerId = workerModelResolution.workerId ?? requestedWorkerId;
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

  if (workerProfile) {
    const eligibility = assessWorkerTaskEligibility(
      workerProfile,
      "patch-generation"
    );
    if (!eligibility.allowed) {
      warnings.push(eligibility.reason);
      const inspection = PatchInspectionSchema.parse({
        ...(await inspectPatch(context, fallbackProposal, {
          scope: effectiveScope
        })),
        ok: false,
        blockedReasons: [
          eligibility.reason,
          "Patch proposal is a fallback placeholder and must not be applied."
        ]
      });

      return {
        proposal: fallbackProposal,
        inspection,
        warnings
      };
    }

    if (eligibility.requiresHostReview) {
      warnings.push(
        `Worker ${workerProfile.workerId} may generate patch proposals only with host review.`
      );
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
    workerProfile
  });
  const proposal = generation.proposal;
  let inspection = await inspectPatch(context, proposal, {
    scope: effectiveScope
  });

  if (!generation.structuredOutputOk) {
    warnings.push("Patch proposal is a fallback placeholder and must not be applied.");
    inspection = PatchInspectionSchema.parse({
      ...inspection,
      ok: false,
      blockedReasons: [
        "Patch proposal is a fallback placeholder and must not be applied.",
        ...inspection.blockedReasons,
        ...generation.errors
      ]
    });
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
      scope: effectiveScope,
      workerId
    }
  });

  return {
    proposal,
    inspection,
    warnings
  };
};
