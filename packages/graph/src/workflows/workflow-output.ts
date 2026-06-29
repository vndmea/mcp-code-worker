import {
  createTaskSessionReportSummary,
  createTaskSessionSummary,
  summarizeValidationReport,
  type OutputDetailLevel,
  truncateText
} from "@mcp-code-worker/core";

import type { FixErrorWorkflowOutput } from "./fix-error-workflow.js";
import {
  isPlaceholderPatchProposal,
  type PatchProposalWorkflowOutput
} from "./patch-proposal-workflow.js";
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

type PatchProposalState = "ready-for-review" | "blocked" | "placeholder";

const buildPatchProposalPresentation = (input: {
  inspection: PatchProposalWorkflowOutput["inspection"];
  proposal: PatchProposalWorkflowOutput["proposal"];
  warnings: PatchProposalWorkflowOutput["warnings"];
}): {
  deniedReason: string | undefined;
  deniedReasons: string[];
  humanSummary: string;
  placeholder: boolean;
  proposalState: PatchProposalState;
} => {
  const deniedReasons = input.inspection.ok
    ? []
    : input.inspection.blockedReasons;
  const deniedReason = deniedReasons[0];
  const placeholder = isPlaceholderPatchProposal(input);
  const proposalState: PatchProposalState = input.inspection.ok
    ? "ready-for-review"
    : placeholder
      ? "placeholder"
      : "blocked";
  const humanSummary = input.inspection.ok
    ? `Patch proposal ${input.proposal.id} is ready for review.`
    : placeholder
      ? `Patch proposal is a placeholder only and must not be applied: ${deniedReason ?? "inspection failed."}`
      : `Patch proposal is blocked: ${deniedReason ?? "inspection failed."}`;

  return {
    proposalState,
    placeholder,
    humanSummary,
    deniedReason,
    deniedReasons
  };
};

const buildTaskOutcomeSnapshot = (
  output: TaskSessionWorkflowOutput
): {
  applyStatus: string;
  outcomeCode: string;
  outcomeSummary: string;
  patchDeniedReason: string | null;
  patchPlaceholder: boolean;
  patchStatus: string;
  reviewStatus: string;
  validationStatus: string;
} => {
  const reviewStatus = !output.reviewResult
    ? "not-produced"
    : output.reviewResult.accepted
      ? "passed"
      : "blocked";
  const notConfiguredChecks = output.validationReport
    ? output.validationReport.checks
        .filter((check) => check.status === "not-configured")
        .map((check) => check.name)
    : [];
  const validationStatus = !output.validationReport
    ? "not-requested"
    : output.validationReport.ok
      ? "passed"
      : notConfiguredChecks.length > 0
        ? "not-configured"
        : "failed";
  const patchPlaceholder = output.patchProposal
    ? isPlaceholderPatchProposal({
        proposal: output.patchProposal,
        inspection: output.patchInspection,
        warnings: []
      })
    : false;
  const patchDeniedReason =
    output.patchInspection && !output.patchInspection.ok
      ? output.patchInspection.blockedReasons[0] ?? null
      : output.patchApplyResult && !output.patchApplyResult.applied
        ? output.patchApplyResult.inspection.blockedReasons[0] ??
          output.patchApplyResult.errors?.[0] ??
          "Patch application was denied."
        : null;
  const patchStatus = !output.patchProposal && !output.patchInspection && !output.patchApplyResult
    ? "not-requested"
    : output.patchApplyResult?.applied
      ? "applied"
      : output.patchInspection?.ok
        ? "ready-for-review"
        : patchPlaceholder
          ? "placeholder"
          : patchDeniedReason
            ? "blocked"
            : "not-produced";
  const applyStatus = !output.patchApplyResult
    ? output.patchProposal || output.patchInspection
      ? "skipped"
      : "not-requested"
    : output.patchApplyResult.applied
      ? "applied"
      : output.patchApplyResult.mode === "dry-run"
        ? "dry-run"
        : "denied";
  const outcomeSummary =
    `review=${reviewStatus} | validation=${validationStatus} | patch=${patchStatus} | apply=${applyStatus}`;

  let outcomeCode = `status-${output.session.status}`;

  if (output.patchApplyResult?.applied) {
    outcomeCode = "completed-with-patch";
  } else if (reviewStatus === "blocked") {
    outcomeCode = "review-gate-blocked";
  } else if (validationStatus === "failed") {
    outcomeCode = "review-passed-validation-failed";
  } else if (reviewStatus === "passed" && patchPlaceholder) {
    outcomeCode = "review-passed-patch-placeholder";
  } else if (reviewStatus === "passed" && patchStatus === "blocked") {
    outcomeCode = "review-passed-patch-blocked";
  } else if (output.session.status === "completed") {
    outcomeCode = "completed";
  }

  return {
    reviewStatus,
    validationStatus,
    patchStatus,
    patchPlaceholder,
    applyStatus,
    outcomeCode,
    outcomeSummary,
    patchDeniedReason
  };
};

const buildTaskHumanSummary = (
  output: TaskSessionWorkflowOutput,
  validation: ReturnType<typeof summarizeValidationReport> | null
): string => {
  const finalStatus = output.session.status;
  const outcome = buildTaskOutcomeSnapshot(output);
  const notConfiguredChecks = output.validationReport
    ? output.validationReport.checks
        .filter((check) => check.status === "not-configured")
        .map((check) => check.name)
    : [];

  if (outcome.patchDeniedReason) {
    if (
      outcome.reviewStatus === "passed" &&
      outcome.validationStatus === "passed"
    ) {
      return outcome.patchPlaceholder
        ? `Review and validation succeeded, but patch generation produced a blocked placeholder: ${outcome.patchDeniedReason}. No repository writes were applied. The task remains ${finalStatus}.`
        : `Review and validation succeeded, but patch inspection blocked the proposal: ${outcome.patchDeniedReason}. No repository writes were applied. The task remains ${finalStatus}.`;
    }

    return `Patch generation was denied: ${outcome.patchDeniedReason}. The task remains ${finalStatus}.`;
  }

  if (output.validationReport && !output.validationReport.ok) {
    if (notConfiguredChecks.length > 0) {
      return `Review succeeded, but validation was not configured for ${notConfiguredChecks.join(", ")}, so the task remains ${finalStatus}.`;
    }

    return `Review succeeded, but deterministic validation failed, so the task remains ${finalStatus}.`;
  }

  if (output.reviewResult && !output.reviewResult.accepted) {
    return `Worker answered successfully, but the review quality gate did not pass, so the task remains ${finalStatus}.`;
  }

  if (finalStatus === "completed") {
    if (output.patchApplyResult?.applied) {
      return "Review, validation, and patch application succeeded. The task is completed.";
    }

    if (output.patchProposal && output.patchInspection?.ok) {
      return "Review succeeded and the patch proposal passed inspection. The task is completed.";
    }

    if (validation?.summary && validation.summary !== "No validation report was recorded.") {
      return `Review completed. ${validation.summary} The task is completed.`;
    }

    return "Review completed and the task is complete.";
  }

  return `Task status is ${finalStatus}.`;
};

export const formatTaskSessionWorkflowOutput = (
  output: TaskSessionWorkflowOutput,
  options?: WorkflowOutputOptions
): TaskSessionWorkflowOutput | Record<string, unknown> => {
  if (isFull(options)) {
    return output;
  }

  const validation = output.validationReport
    ? summarizeValidationReport(output.validationReport, options?.maxBytes)
    : null;
  const artifactRefsIncluded = includeArtifactRefs(options);
  const humanSummary = buildTaskHumanSummary(output, validation);
  const outcome = buildTaskOutcomeSnapshot(output);
  const patchSummary =
    output.patchProposal || output.patchInspection || output.patchApplyResult
      ? {
          proposalId: output.patchProposal?.id ?? "not-produced",
          title: output.patchProposal?.title ?? "not-produced",
          proposalState:
            output.patchProposal && output.patchInspection
              ? buildPatchProposalPresentation({
                  proposal: output.patchProposal,
                  inspection: output.patchInspection,
                  warnings: []
                }).proposalState
              : "not-produced",
          inspectionOk: output.patchInspection?.ok ?? "not-produced",
          deniedReason:
            output.patchInspection && !output.patchInspection.ok
              ? output.patchInspection.blockedReasons[0] ?? "not-produced"
              : output.patchApplyResult && !output.patchApplyResult.applied
                ? output.patchApplyResult.inspection.blockedReasons[0] ??
                  output.patchApplyResult.errors?.[0] ??
                  "not-produced"
                : "not-produced",
          applied: output.patchApplyResult?.applied ?? "not-produced"
        }
      : "not-produced";

  return {
    taskId: output.session.taskId,
    goal: output.session.goal,
    humanSummary,
    outcomeCode: outcome.outcomeCode,
    outcomeSummary: outcome.outcomeSummary,
    reviewStatus: outcome.reviewStatus,
    patchStatus: outcome.patchStatus,
    applyStatus: outcome.applyStatus,
    scope: output.session.scope,
    workerId: output.workerId,
    localClientRuntime: output.localClientRuntime ?? "not-applicable",
    finalStatus: output.session.status,
    workerReviewStatus: output.reviewResult?.workerReviewResult?.status ?? "not-produced",
    accepted: output.reviewResult?.accepted ?? "not-produced",
    validationSummary: validation?.summary ?? "not-produced",
    validationStatus: output.validationReport
      ? output.validationReport.ok
        ? "passed"
        : "failed"
      : "not-produced",
    artifactRefs: artifactRefsIncluded
      ? createTaskSessionSummary(output.session, true)["artifactRefs"] ?? []
      : [],
    artifactRefsStatus: artifactRefsIncluded
      ? "included"
      : "suppressed-in-summary",
    mode: output.mode,
    rootDir: output.rootDir,
    readinessSummary: output.readinessSummary,
    repositoryWriteMode: output.repositoryWriteMode,
    sessionWriteMode: output.sessionWriteMode,
    persistence: output.persistence,
    workspaceBinding: output.workspaceBinding,
    transientNotice: output.transientNotice ?? "not-applicable",
    sessionPath: output.sessionPath,
    nextRecommendedActions: output.nextRecommendedActions,
    reviewSummary: output.reviewResult?.reviewSummary.summary ?? "not-produced",
    fixSummary: output.fixResult?.rootCauseAnalysis ?? "not-produced",
    patch: patchSummary,
    validation: validation ?? "not-produced",
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
    workflowStatus: output.workflowStatus,
    answerStatus: output.answerStatus,
    repository: {
      scope: output.repositoryContext.scope,
      requestedFileCount: output.repositoryContext.requestedFiles.length,
      skippedFileCount: output.repositoryContext.skippedFiles.length,
      coverageGapDetected: output.repositoryContext.coverageGapDetected,
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
    qualityGate: output.qualityGate,
    debug: {
      promptTransparency: output.debug.promptTransparency,
      workerMetadata: output.workerReviewResult?.metadata,
      workerArtifacts:
        output.workerReviewResult?.artifacts.map((artifact) => ({
          name: artifact.name,
          type: artifact.type
        })) ?? [],
      repositoryContext: {
        requestedFiles: output.repositoryContext.requestedFiles,
        skippedFiles: output.repositoryContext.skippedFiles,
        selectedFiles: output.repositoryContext.selectedFiles.map((file) => file.path),
        coverageGapDetected: output.repositoryContext.coverageGapDetected,
        strictFiles: output.repositoryContext.strictFiles,
        warnings: output.repositoryContext.warnings
      }
    }
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
  const patchPresentation = buildPatchProposalPresentation(output);

  return {
    proposalId: output.proposal.id,
    title: output.proposal.title,
    proposalState: patchPresentation.proposalState,
    placeholder: patchPresentation.placeholder,
    readyForReview: patchPresentation.proposalState === "ready-for-review",
    humanSummary: patchPresentation.humanSummary,
    summary: truncateText(output.proposal.summary, options?.maxBytes ?? 1_500),
    workerId: output.proposal.source.workerId,
    scope: output.proposal.source.scope,
    deniedReason: patchPresentation.deniedReason,
    deniedReasons: patchPresentation.deniedReasons,
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
    workflowStatus: output.workflowStatus,
    answerStatus: output.answerStatus,
    repository: {
      scope: output.repositoryContext.scope,
      skippedFileCount: output.repositoryContext.skippedFiles.length,
      coverageGapDetected: output.repositoryContext.coverageGapDetected,
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
