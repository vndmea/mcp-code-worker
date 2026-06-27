import {
  createTaskSessionReportSummary,
  createTaskSessionSummary,
  summarizeValidationReport,
  type OutputDetailLevel,
  truncateText
} from "@agent-orchestrator/core";

import type { FixErrorWorkflowOutput } from "./fix-error-workflow.js";
import type { PatchProposalWorkflowOutput } from "./patch-proposal-workflow.js";
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
    rootDir: output.rootDir,
    readinessSummary: output.readinessSummary,
    repositoryWriteMode: output.repositoryWriteMode,
    sessionWriteMode: output.sessionWriteMode,
    persistence: output.persistence,
    workspaceBinding: output.workspaceBinding,
    transientNotice: output.transientNotice,
    workerId: output.workerId,
    sessionPath: output.sessionPath,
    nextRecommendedActions: output.nextRecommendedActions,
    reviewSummary: output.reviewResult?.reviewSummary.summary,
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
    reviewSummary: output.reviewSummary.summary,
    accepted: output.accepted,
    repository: {
      scope: output.repositoryContext.scope,
      requestedFileCount: output.repositoryContext.requestedFiles.length,
      selectedFileCount: output.repositoryContext.selectedFiles.length,
      strictFiles: output.repositoryContext.strictFiles,
      warningCount: output.repositoryContext.warnings.length,
      diffIncluded: Boolean(output.repositoryContext.gitDiff),
      truncatedFileCount: output.repositoryContext.selectedFiles.filter(
        (file) => file.truncated
      ).length
    },
    validation: summarizeValidationReport(output.validationReport, options?.maxBytes),
    workerReviewStatus: output.workerReviewResult?.status ?? "not-run",
    workflowStatus: output.qualityGate.workflowStatus,
    answerStatus: output.qualityGate.answerStatus,
    qualityGate: output.qualityGate,
    debug: output.workerReviewResult
      ? {
          workerMetadata: output.workerReviewResult.metadata,
          workerArtifacts: output.workerReviewResult.artifacts.map((artifact) => ({
            name: artifact.name,
            type: artifact.type
          })),
          repositoryContext: {
            requestedFiles: output.repositoryContext.requestedFiles,
            selectedFiles: output.repositoryContext.selectedFiles.map((file) => file.path),
            strictFiles: output.repositoryContext.strictFiles,
            warnings: output.repositoryContext.warnings
          }
        }
      : undefined
  };
};

export const formatPatchProposalWorkflowOutput = (
  output: PatchProposalWorkflowOutput,
  options?: WorkflowOutputOptions
): PatchProposalWorkflowOutput | Record<string, unknown> => {
  if (isFull(options)) {
    return output;
  }

  const files = output.inspection.files.length > 0
    ? output.inspection.files
    : output.proposal.files;

  return {
    proposalId: output.proposal.id,
    title: output.proposal.title,
    summary: truncateText(output.proposal.summary, options?.maxBytes ?? 1_500),
    workerId: output.proposal.source.workerId,
    scope: output.proposal.source.scope,
    changedFiles: files.map((file) => ({
      path: file.path,
      changeType: file.changeType,
      riskLevel: file.riskLevel,
      summary: file.summary
    })),
    inspection: {
      ok: output.inspection.ok,
      blockedReasons: output.inspection.blockedReasons,
      warningCount: output.inspection.warnings.length,
      stats: output.inspection.stats
    },
    risks: output.proposal.risks,
    validationPlan: output.proposal.validationPlan,
    warnings: output.warnings,
    diffPreview: truncateText(output.proposal.unifiedDiff, options?.maxBytes)
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
