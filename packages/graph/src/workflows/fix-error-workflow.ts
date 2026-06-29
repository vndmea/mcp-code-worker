import type {
  ExecutionContext,
  RepositoryContextPack,
  ValidationReport
} from "@mcp-code-worker/core";
import { resolveExecutionContext } from "@mcp-code-worker/core";
import {
  buildRepositoryContextPack,
  readRepositoryFile
} from "@mcp-code-worker/tools";

import { runPatchProposalWorkflow } from "./patch-proposal-workflow.js";
import type { HostWorkerWorkflowOutput } from "./host-worker-workflow.js";
import {
  prepareRepositoryWorkflowRuntime,
  runRepositoryScopedWorkerTask
} from "./workflow-repository-runtime.js";

export interface FixErrorWorkflowInput {
  context?: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  proposePatch?: boolean;
  requireProfile?: boolean;
  scope?: string;
  validate?: {
    lint?: boolean;
    test?: boolean;
    typecheck?: boolean;
  };
  workerId?: string;
}

export interface FixErrorWorkflowOutput {
  accepted: boolean;
  analysisResult: HostWorkerWorkflowOutput;
  answerStatus: "complete" | "incomplete";
  candidateFixPlan: string[];
  errors: string[];
  repositoryContext: RepositoryContextPack;
  rootCauseAnalysis: string;
  patchInspection?: Awaited<ReturnType<typeof runPatchProposalWorkflow>>["inspection"];
  patchProposal?: Awaited<ReturnType<typeof runPatchProposalWorkflow>>["proposal"];
  planResult: HostWorkerWorkflowOutput;
  suggestedPatchArtifact: string;
  validationReport: ValidationReport;
  workflowStatus: "completed" | "needs_review";
  warnings: string[];
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const getRootCauseAnalysis = (analysisResult: HostWorkerWorkflowOutput): string => {
  const workerOutput = analysisResult.workerResult?.output as {
    brief?: unknown;
    issue?: unknown;
  } | undefined;

  if (typeof workerOutput?.brief === "string") {
    return workerOutput.brief;
  }

  if (typeof workerOutput?.issue === "string") {
    return workerOutput.issue;
  }

  return analysisResult.qualityGate.answered
    ? "Root cause analysis completed, but the worker response did not include a brief summary."
    : analysisResult.qualityGate.reasons.join(" ");
};

const getCandidateFixPlan = (planResult: HostWorkerWorkflowOutput): string[] => {
  const workerOutput = planResult.workerResult?.output as {
    patchPlan?: unknown;
    notes?: unknown;
  } | undefined;
  const patchPlan = asStringArray(workerOutput?.patchPlan);

  if (patchPlan.length > 0) {
    return patchPlan;
  }

  const notes = asStringArray(workerOutput?.notes);
  if (notes.length > 0) {
    return notes;
  }

  return planResult.qualityGate.answered
    ? [
        "Identify the smallest code path connected to the failing signal.",
        "Limit the fix to the scoped files.",
        "Re-run deterministic validation before accepting the change."
      ]
    : planResult.qualityGate.reasons;
};

export const runFixErrorWorkflow = async (
  input: FixErrorWorkflowInput
): Promise<FixErrorWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const errorLog = input.errorLog ??
    (input.errorLogFile
      ? await readRepositoryFile(input.errorLogFile, context.rootDir)
      : "");
  const runtime = await prepareRepositoryWorkflowRuntime({
    context,
    buildRepositoryContext: () =>
      buildRepositoryContextPack(context, {
        rootDir: context.rootDir,
        scope: input.scope,
        errorLog
      }),
    validate: input.validate
  });
  const sharedTaskInput = {
    errorLog,
    errorLogFile: input.errorLogFile,
    validationReport: runtime.validationReport
  };
  const analysisResult = await runRepositoryScopedWorkerTask({
    context,
    goal: "Analyze the supplied error log and summarize the likely root cause using the scoped repository context.",
    repositoryContext: runtime.repositoryContext,
    requireProfile: input.requireProfile,
    taskType: "log-analysis",
    additionalTaskInput: sharedTaskInput,
    workerId: input.workerId
  });
  const planResult = await runRepositoryScopedWorkerTask({
    context,
    goal: "Produce a safe candidate fix plan for the supplied error log using only the scoped repository context.",
    repositoryContext: runtime.repositoryContext,
    requireProfile: input.requireProfile,
    taskType: "codegen",
    additionalTaskInput: sharedTaskInput,
    workerId: input.workerId
  });
  const accepted =
    analysisResult.qualityGate.answered &&
    planResult.qualityGate.answered;
  const rootCauseAnalysis = getRootCauseAnalysis(analysisResult);
  const candidateFixPlan = getCandidateFixPlan(planResult);
  const patchResult = input.proposePatch
    ? await runPatchProposalWorkflow({
        context,
        errorLog,
        fixResult: {
          candidateFixPlan
        },
        goal: input.scope
          ? `Fix issues within ${input.scope}`
          : "Fix the supplied repository issue",
        repositoryContext: runtime.repositoryContext,
        scope: runtime.scope,
        validationReport: runtime.validationReport,
        workerId: input.workerId,
        requireProfile: input.requireProfile
      })
    : undefined;

  return {
    accepted,
    analysisResult,
    answerStatus: accepted ? "complete" : "incomplete",
    candidateFixPlan,
    errors: [...analysisResult.errors, ...planResult.errors],
    ...(patchResult
      ? {
          patchProposal: patchResult.proposal,
          patchInspection: patchResult.inspection
        }
      : {}),
    planResult,
    repositoryContext: runtime.repositoryContext,
    rootCauseAnalysis,
    suggestedPatchArtifact: "candidate-patch-plan.md",
    validationReport: runtime.validationReport,
    workflowStatus:
      analysisResult.qualityGate.workflowStatus === "completed" &&
      planResult.qualityGate.workflowStatus === "completed"
        ? "completed"
        : "needs_review",
    warnings: [
      ...analysisResult.warnings,
      ...planResult.warnings,
      ...(patchResult?.warnings ?? [])
    ]
  };
};
