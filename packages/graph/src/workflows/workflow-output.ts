import {
  createTaskSessionReportSummary,
  createTaskSessionSummary,
  summarizeValidationReport,
  type OutputDetailLevel,
  truncateText
} from "@agent-orchestrator/core";

import type { FixErrorWorkflowOutput } from "./fix-error-workflow.js";
import type { ReviewWorkflowOutput } from "./review-workflow.js";
import type { TaskSessionWorkflowOutput } from "./task-session-workflow.js";

export interface WorkflowOutputOptions {
  detailLevel?: OutputDetailLevel;
  includeArtifactRefs?: boolean;
  maxBytes?: number;
}

const isFull = (options: WorkflowOutputOptions | undefined): boolean =>
  options?.detailLevel === "full";

const includeArtifactRefs = (
  options: WorkflowOutputOptions | undefined
): boolean => options?.includeArtifactRefs ?? true;

export const formatTaskSessionWorkflowOutput = (
  output: TaskSessionWorkflowOutput,
  options?: WorkflowOutputOptions
): TaskSessionWorkflowOutput | Record<string, unknown> => {
  if (isFull(options)) {
    return output;
  }

  return {
    ...createTaskSessionSummary(output.session, includeArtifactRefs(options)),
    mode: output.mode,
    workerId: output.workerId,
    sessionPath: output.sessionPath,
    nextRecommendedActions: output.nextRecommendedActions,
    reviewSummary: output.reviewResult?.leaderReview.summary,
    fixSummary: output.fixResult?.rootCauseAnalysis,
    patch:
      output.patchProposal || output.patchInspection || output.patchApplyResult
        ? {
            proposalId: output.patchProposal?.id,
            title: output.patchProposal?.title,
            inspectionOk: output.patchInspection?.ok,
            applied: output.patchApplyResult?.applied ?? false
          }
        : undefined,
    validation: output.validationReport
      ? summarizeValidationReport(output.validationReport, options?.maxBytes)
      : undefined,
    reportPreview: truncateText(output.report, options?.maxBytes ?? 4_000)
  };
};

export const formatTaskSessionStatusOutput = (
  session: TaskSessionWorkflowOutput["session"],
  options?: WorkflowOutputOptions
) =>
  isFull(options)
    ? session
    : createTaskSessionSummary(session, includeArtifactRefs(options));

export const formatTaskSessionListOutput = (
  sessions: TaskSessionWorkflowOutput["session"][],
  options?: WorkflowOutputOptions
) =>
  isFull(options)
    ? sessions
    : sessions.map((session) =>
        createTaskSessionSummary(session, includeArtifactRefs(options))
      );

export const formatTaskSessionReportOutput = (
  output: {
    report: string;
    session: TaskSessionWorkflowOutput["session"];
  },
  options?: WorkflowOutputOptions
) =>
  isFull(options)
    ? output
    : createTaskSessionReportSummary(
        output.session,
        output.report,
        options?.maxBytes,
        includeArtifactRefs(options)
      );

export const formatReviewWorkflowOutput = (
  output: ReviewWorkflowOutput,
  options?: WorkflowOutputOptions
): ReviewWorkflowOutput | Record<string, unknown> => {
  if (isFull(options)) {
    return output;
  }

  return {
    leaderSummary: output.leaderReview.summary,
    repository: {
      scope: output.repositoryContext.scope,
      selectedFileCount: output.repositoryContext.selectedFiles.length,
      warningCount: output.repositoryContext.warnings.length,
      diffIncluded: Boolean(output.repositoryContext.gitDiff),
      truncatedFileCount: output.repositoryContext.selectedFiles.filter(
        (file) => file.truncated
      ).length
    },
    validation: summarizeValidationReport(output.validationReport, options?.maxBytes),
    workerReviewStatus: output.workerReviewResult?.status ?? "not-run"
  };
};

export const formatFixErrorWorkflowOutput = (
  output: FixErrorWorkflowOutput,
  options?: WorkflowOutputOptions
): FixErrorWorkflowOutput | Record<string, unknown> => {
  if (isFull(options)) {
    return output;
  }

  return {
    rootCauseAnalysis: output.rootCauseAnalysis,
    candidateFixPlan: output.candidateFixPlan,
    repository: {
      scope: output.repositoryContext.scope,
      selectedFileCount: output.repositoryContext.selectedFiles.length,
      warningCount: output.repositoryContext.warnings.length
    },
    validation: summarizeValidationReport(output.validationReport, options?.maxBytes),
    patch:
      output.patchProposal || output.patchInspection
        ? {
            proposalId: output.patchProposal?.id,
            title: output.patchProposal?.title,
            inspectionOk: output.patchInspection?.ok
          }
        : undefined
  };
};
