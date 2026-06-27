import type {
  AgentResult,
  ExecutionContext,
  RepositoryContextPack,
  ReviewSummary,
  ValidationReport
} from "@agent-orchestrator/core";
import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  buildRepositoryContextPack,
  readGitDiff,
  runRepositoryValidation
} from "@agent-orchestrator/tools";

import type {
  HostWorkerWorkflowOutput,
  HostWorkerWorkflowQualityGate
} from "./host-worker-workflow.js";
import { runHostWorkerWorkflow } from "./host-worker-workflow.js";

export interface ReviewWorkflowInput {
  context?: ExecutionContext;
  diff?: string;
  diffBase?: string;
  diffHead?: string;
  files?: string[];
  includeDiff?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  requireProfile?: boolean;
  scope?: string;
  strictFiles?: boolean;
  validate?: {
    lint?: boolean;
    test?: boolean;
    typecheck?: boolean;
  };
  workerId?: string;
}

export interface ReviewWorkflowOutput {
  accepted: boolean;
  answerStatus: "complete" | "incomplete";
  errors: string[];
  qualityGate: HostWorkerWorkflowQualityGate;
  repositoryContext: RepositoryContextPack;
  reviewSummary: ReviewSummary;
  validationReport: ValidationReport;
  workflowStatus: "completed" | "needs_review";
  warnings: string[];
  workerReviewResult: AgentResult | null;
  debug: HostWorkerWorkflowOutput["debug"];
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const buildReviewSummary = (input: {
  qualityGate: HostWorkerWorkflowQualityGate;
  repositoryContext: RepositoryContextPack;
  validationReport: ValidationReport;
  workerResult: AgentResult | null;
}): ReviewSummary => {
  const selectedPaths = input.repositoryContext.selectedFiles.map((file) => file.path);
  const findings = input.workerResult
    ? asStringArray((input.workerResult.output as { findings?: unknown }).findings)
    : [];
  const failedChecks = input.validationReport.checks
    .filter((check) => check.status === "failure")
    .map((check) => `${check.name} validation failed.`);
  const mustFixItems = [
    ...input.qualityGate.reasons,
    ...failedChecks,
    ...findings.slice(0, 2)
  ];
  const shouldFixItems = findings.slice(2);
  const summaryPrefix = input.qualityGate.answered
    ? "Host-managed review answered the scoped repository question directly."
    : "Host-managed review did not meet the answer-quality gate.";

  return {
    summary: `${summaryPrefix} Reviewed ${selectedPaths.length} selected file(s).`,
    architectureImpact:
      selectedPaths.length > 0
        ? `Focused on ${selectedPaths.join(", ")}.`
        : "No repository files were selected for review.",
    mustFixItems,
    shouldFixItems,
    missingTests: input.validationReport.ok
      ? []
      : input.validationReport.checks
          .filter((check) => check.status !== "success")
          .map((check) => `Re-run ${check.name} after updating the scoped files.`),
    riskLevel:
      !input.qualityGate.answered || !input.validationReport.ok
        ? "high"
        : findings.length > 2
          ? "medium"
          : "low"
  };
};

export const runReviewWorkflow = async (
  input: ReviewWorkflowInput
): Promise<ReviewWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const diffSummary =
    input.diff
      ? {
          base: input.diffBase,
          head: input.diffHead,
          changedFiles: [],
          diffText: input.diff,
          truncated: false
        }
      : input.includeDiff || input.diffBase || input.diffHead
        ? await readGitDiff(context, {
            base: input.diffBase,
            head: input.diffHead
          })
        : undefined;
  const repositoryContextBase = await buildRepositoryContextPack(context, {
    rootDir: context.rootDir,
    scope: input.scope,
    files: input.files,
    includeDiff: !input.diff && Boolean(diffSummary),
    diffBase: diffSummary?.base,
    diffHead: diffSummary?.head,
    maxFileBytes: input.maxFileBytes,
    maxTotalBytes: input.maxTotalBytes,
    strictFiles: input.strictFiles
  });
  const repositoryContext = diffSummary
    ? {
        ...repositoryContextBase,
        gitDiff: diffSummary
      }
    : repositoryContextBase;
  const effectiveScope = repositoryContext.scope;
  const validationReport = await runRepositoryValidation(context, {
    typecheck: input.validate?.typecheck,
    lint: input.validate?.lint,
    test: input.validate?.test,
    scope: effectiveScope
  });
  const workerRun = await runHostWorkerWorkflow({
    context,
    files: input.files,
    goal: "Review the selected repository context for concrete implementation and validation risks.",
    maxFileBytes: input.maxFileBytes,
    maxTotalBytes: input.maxTotalBytes,
    repositoryContext,
    requireProfile: input.requireProfile,
    scope: effectiveScope,
    strictFiles: input.strictFiles,
    taskType: "review-lite",
    additionalTaskInput: {
      diff: diffSummary?.diffText ?? input.diff,
      validationReport
    },
    workerId: input.workerId
  });
  const reviewSummary = buildReviewSummary({
    qualityGate: workerRun.qualityGate,
    repositoryContext,
    validationReport,
    workerResult: workerRun.workerResult
  });

  return {
    accepted: workerRun.qualityGate.answered,
    answerStatus: workerRun.qualityGate.answerStatus,
    debug: workerRun.debug,
    errors: workerRun.errors,
    qualityGate: workerRun.qualityGate,
    repositoryContext,
    reviewSummary,
    validationReport,
    workflowStatus: workerRun.qualityGate.workflowStatus,
    warnings: workerRun.warnings,
    workerReviewResult: workerRun.workerResult
  };
};
