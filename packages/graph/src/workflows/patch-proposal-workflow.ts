import {
  PatchInspectionSchema,
  type ExecutionContext,
  type PatchInspection,
  type PatchProposal,
  type RepositoryContextPack,
  type WorkerResultEnvelope,
  type WorkerTaskEnvelope,
  type WorkerTrustProfile,
  recordWorkerTaskExecution,
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
import { CodexHostAdapter } from "../host/codex-host-adapter.js";
import {
  buildMissingWorkerTrustProfile,
  buildWorkerTrustProfile
} from "./worker-trust-profile.js";
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

const buildPatchResultEnvelope = (input: {
  hostTaskId: string;
  inspection: PatchInspection;
  modelBehaviorProfile?: string;
  proposal: PatchProposal;
  semanticValidation: HostSemanticValidationResult;
  structuredOutputAttempts: number;
  structuredOutputFallbackReason?: string;
  structuredOutputMode: WorkerResultEnvelope["diagnostics"]["structuredOutputMode"];
}): WorkerResultEnvelope => ({
  taskEnvelopeId: input.hostTaskId,
  taskType: "patch-generation",
  status: input.semanticValidation.resultStatus,
  output: input.proposal,
  failure: input.semanticValidation.issues.length > 0 || !input.inspection.ok
    ? {
        kind: input.inspection.ok ? "semantic-validation" : "policy-blocked",
        reasons: [
          ...input.inspection.blockedReasons,
          ...input.semanticValidation.issues.map((issue) => issue.reason)
        ]
      }
    : undefined,
  diagnostics: {
    modelBehaviorProfile: input.modelBehaviorProfile,
    structuredOutputAttempts: input.structuredOutputAttempts,
    structuredOutputFallbackReason: input.structuredOutputFallbackReason,
    structuredOutputMode: input.structuredOutputMode
  }
});

const recordAndAuditPatchProposalExecution = async (input: {
  context: ExecutionContext;
  effectiveScope?: string;
  inspection: PatchInspection;
  modelBehaviorProfile?: string;
  outputSummary: string;
  proposal: PatchProposal;
  semanticValidation: HostSemanticValidationResult;
  structuredOutputAttempts: number;
  structuredOutputFallbackReason?: string;
  structuredOutputMode: WorkerResultEnvelope["diagnostics"]["structuredOutputMode"];
  taskEnvelope: WorkerTaskEnvelope;
  workflowInput: PatchProposalWorkflowInput;
  warnings: string[];
  workerId: string;
  workerTrustProfile: WorkerTrustProfile;
}): Promise<void> => {
  const resultEnvelope = buildPatchResultEnvelope({
    hostTaskId: input.taskEnvelope.id,
    inspection: input.inspection,
    modelBehaviorProfile: input.modelBehaviorProfile,
    proposal: input.proposal,
    semanticValidation: input.semanticValidation,
    structuredOutputAttempts: input.structuredOutputAttempts,
    structuredOutputFallbackReason: input.structuredOutputFallbackReason,
    structuredOutputMode: input.structuredOutputMode
  });
  const executionRecord = await recordWorkerTaskExecution(input.context, {
    artifactRefs: [input.proposal.id],
    diagnostics: {
      inspection: input.inspection,
      semanticValidation: input.semanticValidation,
      workflow: "patch-proposal-workflow"
    },
    resultEnvelope,
    taskEnvelope: input.taskEnvelope,
    workerId: input.workerId,
    workerTrustProfile: input.workerTrustProfile
  });

  await writeAuditEvent(input.context, {
    actor: "workflow",
    action: "propose-patch",
    mode: input.context.dryRun ? "dry-run" : "execute",
    workflow: "patch-proposal-workflow",
    inputSummary:
      input.workflowInput.goal ?? input.workflowInput.scope ?? "patch proposal",
    outputSummary: input.outputSummary,
    warnings: input.warnings,
    errors: input.inspection.blockedReasons,
    metadata: {
      executionRecordId: executionRecord.record.id,
      executionRecordWritten: executionRecord.written,
      patchId: input.proposal.id,
      semanticResultStatus: input.semanticValidation.resultStatus,
      scope: input.effectiveScope,
      workerId: input.workerId
    }
  });
};

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
  const workerTrustProfile = workerProfile
    ? buildWorkerTrustProfile({
        eligibilityAllowed: patchEligibility?.allowed ?? false,
        forceExecution: false,
        profile: workerProfile,
        profileWarnings: workerProfile.warnings,
        taskType: "patch-generation"
      })
    : buildMissingWorkerTrustProfile(workerId);
  const hostAdapter = new CodexHostAdapter();
  const hostTask = hostAdapter.buildWorkerTask({
    additionalTaskInput: {
      errorLog: input.errorLog,
      fixResult: input.fixResult,
      reviewResult: input.reviewResult,
      validationReport: input.validationReport,
      workerId
    },
    context: workerContext,
    goal: input.goal ?? "Propose a safe patch.",
    repositoryContext,
    taskType: "patch-generation"
  });

  if (workerProfile) {
    const patchGenerationConsistencyIssue =
      getPatchGenerationConsistencyIssue(workerProfile);

    if (patchGenerationConsistencyIssue) {
      const denied = await buildDeniedPatchProposalOutput({
        context,
        fallbackProposal,
        repositoryContext,
        reason:
          `${patchGenerationConsistencyIssue} Re-run 'cw worker benchmark --worker ${workerProfile.workerId} --suite coding-v1 --save --update-profile-capabilities'.`,
        scope: effectiveScope,
        validationReport: input.validationReport
      });
      await recordAndAuditPatchProposalExecution({
        context,
        effectiveScope,
        inspection: denied.inspection,
        outputSummary: "Patch proposal blocked before worker execution.",
        proposal: denied.proposal,
        semanticValidation: denied.semanticValidation,
        structuredOutputAttempts: 0,
        structuredOutputMode: "none",
        taskEnvelope: hostTask.envelope,
        workflowInput: input,
        warnings: denied.warnings,
        workerId,
        workerTrustProfile
      });

      return denied;
    }

    if (patchEligibility && !patchEligibility.allowed) {
      const denied = await buildDeniedPatchProposalOutput({
        context,
        fallbackProposal,
        repositoryContext,
        reason: patchEligibility.reason,
        scope: effectiveScope,
        validationReport: input.validationReport
      });
      await recordAndAuditPatchProposalExecution({
        context,
        effectiveScope,
        inspection: denied.inspection,
        outputSummary: "Patch proposal blocked before worker execution.",
        proposal: denied.proposal,
        semanticValidation: denied.semanticValidation,
        structuredOutputAttempts: 0,
        structuredOutputMode: "none",
        taskEnvelope: hostTask.envelope,
        workflowInput: input,
        warnings: denied.warnings,
        workerId,
        workerTrustProfile
      });

      return denied;
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
  await recordAndAuditPatchProposalExecution({
    context,
    effectiveScope,
    inspection,
    modelBehaviorProfile: generation.modelBehaviorProfile,
    outputSummary: inspection.ok
      ? "Patch proposal generated."
      : "Patch proposal generated but inspection blocked it.",
    proposal,
    semanticValidation,
    structuredOutputAttempts: generation.structuredOutputAttempts,
    structuredOutputFallbackReason: generation.structuredOutputFallbackReason,
    structuredOutputMode: generation.structuredOutputMode,
    taskEnvelope: hostTask.envelope,
    workflowInput: input,
    warnings,
    workerId,
    workerTrustProfile
  });

  return {
    proposal,
    inspection,
    semanticValidation,
    warnings
  };
};
