import type {
  PatchApplyResult,
  PatchInspection,
  PatchProposal,
  RepositoryContextPack,
  ValidationReport
} from "../index.js";
import type { TaskSession } from "../schemas/task-session.schema.js";

const summarizeReview = (reviewResult: unknown): string => {
  if (!reviewResult || typeof reviewResult !== "object") {
    return "No review result recorded.";
  }

  const value = reviewResult as { leaderReview?: { summary?: string } };
  return value.leaderReview?.summary ?? "Review result is present.";
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
  if (!validationReport) {
    return "No validation report recorded.";
  }

  if (validationReport.ok) {
    return `Validation passed across ${validationReport.checks.length} check(s).`;
  }

  const failedChecks = validationReport.checks
    .filter((check) => check.status === "failure")
    .map((check) => check.name);

  return `Validation requires review. Failed checks: ${failedChecks.join(", ") || "unknown"}.`;
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
  fixResult?: unknown;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  reviewResult?: unknown;
  session: TaskSession;
  validationReport?: ValidationReport;
}): string {
  const {
    session,
    repositoryContext,
    reviewResult,
    fixResult,
    patchProposal,
    patchInspection,
    patchApplyResult,
    validationReport
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
    `## Repository Context`,
    repositoryContext
      ? `- Selected Files: ${repositoryContext.selectedFiles.length}\n- Warnings: ${repositoryContext.warnings.length}`
      : `- No repository context artifact recorded.`,
    ``,
    `## Step Summary`,
    ...stepLines,
    ``,
    `## Review Summary`,
    `- ${summarizeReview(reviewResult)}`,
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
