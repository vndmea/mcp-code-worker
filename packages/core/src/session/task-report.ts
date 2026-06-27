import type {
  PatchApplyResult,
  PatchInspection,
  PatchProposal,
  RepositoryContextPack,
  ValidationReport,
  WorkspaceBindingSummary
} from "../index.js";
import type { TaskSession } from "../schemas/task-session.schema.js";
import { summarizeValidationOutcome } from "../validation/validation-report.js";

const summarizeReview = (reviewResult: unknown): string => {
  if (!reviewResult || typeof reviewResult !== "object") {
    return "No review result recorded.";
  }

  const value = reviewResult as { reviewSummary?: { summary?: string } };
  return value.reviewSummary?.summary ?? "Review result is present.";
};

const summarizeReviewDebug = (reviewResult: unknown): string[] => {
  if (!reviewResult || typeof reviewResult !== "object") {
    return ["- Debug: no review debug data recorded."];
  }

  const value = reviewResult as {
    debug?: {
      qualityGate?: {
        answerStatus?: string;
        failureStages?: string[];
        workflowStatus?: string;
      };
      repositoryContext?: {
        requestedFiles?: string[];
        selectedFiles?: string[];
        strictFiles?: boolean;
      };
      worker?: {
        metadata?: {
          failureKind?: string;
          prompt?: string;
        };
      } | null;
    };
  };
  const debug = value.debug;

  if (!debug) {
    return ["- Debug: no review debug data recorded."];
  }

  return [
    `- Workflow Status: ${debug.qualityGate?.workflowStatus ?? "unknown"}`,
    `- Answer Status: ${debug.qualityGate?.answerStatus ?? "unknown"}`,
    `- Failure Stages: ${debug.qualityGate?.failureStages?.join(", ") || "none"}`,
    `- Requested Files: ${debug.repositoryContext?.requestedFiles?.join(", ") || "none"}`,
    `- Selected Files: ${debug.repositoryContext?.selectedFiles?.join(", ") || "none"}`,
    `- Strict Files: ${debug.repositoryContext?.strictFiles ? "yes" : "no"}`,
    `- Worker Failure Kind: ${debug.worker?.metadata?.failureKind ?? "none"}`,
    `- Worker Prompt Present: ${typeof debug.worker?.metadata?.prompt === "string" ? "yes" : "no"}`
  ];
};

const summarizeFix = (fixResult: unknown): string => {
  if (!fixResult || typeof fixResult !== "object") {
    return "No fix result recorded.";
  }

  const value = fixResult as { rootCauseAnalysis?: string };
  return value.rootCauseAnalysis ?? "Fix result is present.";
};

const summarizeValidation = (
  validationReport: ValidationReport | undefined
): string => {
  return summarizeValidationOutcome(validationReport).summary;
};

const summarizePatch = (
  patchProposal: PatchProposal | undefined,
  patchInspection: PatchInspection | undefined,
  patchApplyResult: PatchApplyResult | undefined
): string => {
  if (!patchProposal) {
    return "No patch proposal recorded.";
  }

  if (patchApplyResult?.applied) {
    return `Patch ${patchProposal.id} was applied in ${patchApplyResult.mode} mode.`;
  }

  if (patchInspection && !patchInspection.ok) {
    return `Patch ${patchProposal.id} was blocked: ${patchInspection.blockedReasons.join("; ")}`;
  }

  return `Patch ${patchProposal.id} was proposed for manual review.`;
};

const renderRecoverySection = (
  patchApplyResult: PatchApplyResult | undefined
): string[] => {
  const recovery = patchApplyResult?.recovery;
  if (!recovery) {
    return ["- No recovery guidance recorded."];
  }

  return [
    `- Validation Failed: ${recovery.validationFailed ? "yes" : "no"}`,
    `- Failed Checks: ${recovery.failedChecks.join(", ") || "None"}`,
    `- Safe Rollback Commands Available: ${recovery.safeToRunRollbackCommands ? "yes" : "no"}`,
    `- Rollback Commands: ${recovery.rollbackCommands.join(" ; ") || "None"}`,
    ...recovery.manualRecoveryGuide.map((line) => `- ${line}`)
  ];
};

const renderNextAction = (
  session: TaskSession,
  patchInspection: PatchInspection | undefined,
  patchApplyResult: PatchApplyResult | undefined
): string => {
  if (patchInspection && !patchInspection.ok) {
    return "Inspect blocked patch paths and revise the proposal before retrying.";
  }

  if (patchApplyResult?.recovery) {
    return patchApplyResult.recovery.safeToRunRollbackCommands
      ? "Patch applied but validation failed; use the recovery guidance and rerun validation."
      : "Patch applied but validation failed on a previously dirty worktree; inspect diffs manually before restoring files.";
  }

  if (session.status === "completed") {
    return "Session is complete. Review artifacts and decide whether to keep or refine the result.";
  }

  return "Review the latest session artifacts and resume the task if more work is needed.";
};

export function renderTaskSessionReport(input: {
  artifactRegistryComplete?: boolean;
  artifactsReadable?: boolean;
  fixResult?: unknown;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  repositoryWriteMode?: "execute" | "dry-run";
  reviewResult?: unknown;
  rootDir?: string;
  sessionPersisted?: boolean;
  sessionWriteMode?: "execute" | "dry-run";
  session: TaskSession;
  validationReport?: ValidationReport;
  workspaceBinding?: WorkspaceBindingSummary;
}): string {
  const {
    session,
    repositoryContext,
    reviewResult,
    fixResult,
    patchProposal,
    patchInspection,
    patchApplyResult,
    validationReport,
    rootDir,
    workspaceBinding,
    repositoryWriteMode,
    sessionWriteMode,
    sessionPersisted,
    artifactsReadable,
    artifactRegistryComplete
  } = input;
  const stepLines = session.steps.map(
    (step) => `- ${step.name}: ${step.status}`
  );
  const warningLines = session.warnings.length > 0
    ? session.warnings.map((warning) => `- ${warning}`)
    : ["- None"];
  const errorLines = session.errors.length > 0
    ? session.errors.map((error) => `- ${error}`)
    : ["- None"];

  return [
    `# Task Session Report`,
    ``,
    `- Task ID: ${session.taskId}`,
    `- Goal: ${session.goal}`,
    `- Scope: ${session.scope ?? "Not provided"}`,
    `- Worker: ${session.workerId ?? "Default worker"}`,
    `- Status: ${session.status}`,
    `- Created At: ${session.createdAt}`,
    `- Updated At: ${session.updatedAt}`,
    ``,
    `## Workspace Binding`,
    `- Active Root Directory: ${rootDir ?? "Not recorded"}`,
    `- Caller Working Directory: ${workspaceBinding?.callerWorkingDirectory ?? "Not recorded"}`,
    `- Binding Matches Caller: ${workspaceBinding ? (workspaceBinding.matchesCallerWorkingDirectory ? "yes" : "no") : "unknown"}`,
    `- Binding Note: ${workspaceBinding?.warning ?? "No workspace switch warning."}`,
    ``,
    `## Write Modes`,
    `- Repository Write Mode: ${repositoryWriteMode ?? "Not recorded"}`,
    `- Session Write Mode: ${sessionWriteMode ?? "Not recorded"}`,
    ``,
    `## Persistence`,
    `- Session Persisted: ${typeof sessionPersisted === "boolean" ? (sessionPersisted ? "yes" : "no") : "Not recorded"}`,
    `- Artifacts Readable Later: ${typeof artifactsReadable === "boolean" ? (artifactsReadable ? "yes" : "no") : "Not recorded"}`,
    `- Artifact Registry Complete: ${typeof artifactRegistryComplete === "boolean" ? (artifactRegistryComplete ? "yes" : "no") : "Not recorded"}`,
    ``,
    `## Repository Context`,
    repositoryContext
      ? `- Selected Files: ${repositoryContext.selectedFiles.length}\n- Requested Files: ${repositoryContext.requestedFiles.length}\n- Strict Files: ${repositoryContext.strictFiles ? "yes" : "no"}\n- Warnings: ${repositoryContext.warnings.length}`
      : `- No repository context artifact recorded.`,
    ``,
    `## Step Summary`,
    ...stepLines,
    ``,
    `## Review Summary`,
    `- ${summarizeReview(reviewResult)}`,
    ``,
    `## Review Debug`,
    ...summarizeReviewDebug(reviewResult),
    ``,
    `## Fix Summary`,
    `- ${summarizeFix(fixResult)}`,
    ``,
    `## Patch Summary`,
    `- ${summarizePatch(patchProposal, patchInspection, patchApplyResult)}`,
    ``,
    `## Validation Summary`,
    `- ${summarizeValidation(validationReport)}`,
    ``,
    `## Recovery Guidance`,
    ...renderRecoverySection(patchApplyResult),
    ``,
    `## Warnings`,
    ...warningLines,
    ``,
    `## Errors`,
    ...errorLines,
    ``,
    `## Next Recommended Action`,
    `- ${renderNextAction(session, patchInspection, patchApplyResult)}`
  ].join("\n");
}
