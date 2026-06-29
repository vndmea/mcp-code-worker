import {
  AgentError,
  buildWorkspaceBindingSummary,
  resolveExecutionContext,
  summarizeValidationOutcome,
  createTaskSession,
  getTaskSessionPath,
  listTaskSessions,
  readTaskArtifact,
  readTaskSession,
  renderTaskSessionReport,
  type ExecutionContext,
  type PatchApplyResult,
  type PatchInspection,
  type PatchProposal,
  type RepositoryContextPack,
  type TaskSession,
  type TaskSessionStatus,
  type TaskSessionStep,
  type ValidationReport,
  type WorkspaceBindingSummary,
  updateTaskSession,
  writeTaskArtifact
} from "@mcp-code-worker/core";
import { applyPatchProposal } from "@mcp-code-worker/tools";

import {
  runFixErrorWorkflow,
  type FixErrorWorkflowOutput
} from "./fix-error-workflow.js";
import {
  isPlaceholderPatchProposal,
  runPatchProposalWorkflow,
  type PatchProposalWorkflowOutput
} from "./patch-proposal-workflow.js";
import {
  runReviewWorkflow,
  type ReviewWorkflowOutput
} from "./review-workflow.js";
import {
  resolveWorkflowWorkerContext,
  type LocalClientRuntimeSummary
} from "./worker-context-resolution.js";

export interface TaskSessionValidationOptions {
  lint?: boolean;
  test?: boolean;
  typecheck?: boolean;
}

export interface TaskSessionWorkflowInput {
  allowDirtyWorktree?: boolean;
  allowWrite?: boolean;
  allowWriteSession?: boolean;
  applyPatch?: boolean;
  confirmApply?: boolean;
  context?: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  goal: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  requireProfile?: boolean;
  runFix?: boolean;
  scope?: string;
  validate?: TaskSessionValidationOptions;
  workerId?: string;
}

export interface ResumeTaskSessionWorkflowInput {
  allowDirtyWorktree?: boolean;
  allowWrite?: boolean;
  allowWriteSession?: boolean;
  applyPatch?: boolean;
  confirmApply?: boolean;
  context?: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  fromStep?: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  runFix?: boolean;
  taskId: string;
}

export interface TaskSessionWorkflowOutput {
  fixResult?: FixErrorWorkflowOutput;
  localClientRuntime?: LocalClientRuntimeSummary;
  mode: "execute" | "dry-run";
  nextRecommendedActions: NextRecommendedAction[];
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  persistence: TaskSessionPersistenceState;
  readinessSummary: string;
  report: string;
  repositoryWriteMode: "execute" | "dry-run";
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  rootDir: string;
  session: TaskSession;
  sessionPath: string;
  sessionWriteMode: "execute" | "dry-run";
  transientNotice?: string;
  validationReport?: ValidationReport;
  workerId: string;
  workspaceBinding: WorkspaceBindingSummary;
}

export interface NextRecommendedAction {
  action:
    | "confirm_apply"
    | "dry_run_apply"
    | "inspect_patch"
    | "manual_review"
    | "persist_session"
    | "propose_patch"
    | "view_report";
  reason: string;
  command?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface TaskSessionPersistenceState {
  artifactRegistryComplete: boolean;
  artifactsReadable: boolean;
  reportRegistered: boolean;
  resumable: boolean;
  sessionPersisted: boolean;
  storageKind: "persisted" | "temporary";
}

const STEP_IDS = [
  "context-built",
  "reviewed",
  "fix-planned",
  "validated",
  "patch-proposed",
  "patch-inspected",
  "patch-applied"
] as const;
type TaskStepId = (typeof STEP_IDS)[number];

const ARTIFACT_NAMES = {
  repositoryContext: "repository-context.json",
  reviewResult: "review-result.json",
  validationReport: "validation-report.json",
  fixResult: "fix-result.json",
  patchProposal: "patch-proposal.json",
  patchInspection: "patch-inspection.json",
  patchApplyResult: "patch-apply-result.json",
  report: "report.md"
} as const;

const TASK_STEP_LABELS: Record<TaskStepId, string> = {
  "context-built": "Repository context built",
  reviewed: "Repository reviewed",
  "fix-planned": "Fix plan created",
  validated: "Validation recorded",
  "patch-proposed": "Patch proposed",
  "patch-inspected": "Patch inspected",
  "patch-applied": "Patch applied"
};

const buildDefaultValidation = (
  validation: TaskSessionValidationOptions | undefined
): Required<TaskSessionValidationOptions> => ({
  typecheck: validation?.typecheck ?? false,
  lint: validation?.lint ?? false,
  test: validation?.test ?? false
});

const normalizeStepId = (value: string | undefined): TaskStepId | undefined => {
  if (!value) {
    return undefined;
  }

  if (STEP_IDS.includes(value as TaskStepId)) {
    return value as TaskStepId;
  }

  throw new AgentError("TASK_STEP_INVALID", `Unknown task step: ${value}`, {
    value
  });
};

const getStep = (session: TaskSession, stepId: TaskStepId): TaskSessionStep => {
  const existing = session.steps.find((step) => step.id === stepId);

  if (existing) {
    return existing;
  }

  const created: TaskSessionStep = {
    id: stepId,
    name: TASK_STEP_LABELS[stepId],
    status: "pending",
    warnings: [],
    errors: []
  };
  session.steps.push(created);
  return created;
};

const markStepRunning = (step: TaskSessionStep): void => {
  step.status = "running";
  step.startedAt = new Date().toISOString();
  step.warnings = [];
  step.errors = [];
};

const finalizeStep = (
  step: TaskSessionStep,
  status: TaskSessionStep["status"],
  options: {
    artifactPath?: string;
    errors?: string[];
    warnings?: string[];
  } = {}
): void => {
  step.status = status;
  step.completedAt = new Date().toISOString();
  step.warnings = options.warnings ?? step.warnings;
  step.errors = options.errors ?? step.errors;
  step.artifactPath = options.artifactPath ?? step.artifactPath;
};

const syncSessionState = async (
  context: ExecutionContext,
  session: TaskSession,
  status: TaskSessionStatus,
  allowWriteSession: boolean
): Promise<void> => {
  session.status = status;
  await updateTaskSession(context, session, allowWriteSession);
};

const settleTaskSessionState = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  failureStatus?: TaskSessionStatus;
  session: TaskSession;
  successStatus: TaskSessionStatus;
  succeeded: boolean;
}): Promise<void> =>
  syncSessionState(
    input.context,
    input.session,
    input.succeeded ? input.successStatus : input.failureStatus ?? "needs-review",
    input.allowWriteSession
  );

const persistArtifact = async (
  context: ExecutionContext,
  session: TaskSession,
  artifactName: string,
  value: unknown,
  allowWriteSession: boolean
): Promise<string> => {
  const result = await writeTaskArtifact(
    context,
    session.taskId,
    artifactName,
    value,
    allowWriteSession
  );
  session.artifacts[artifactName] = result.path;
  return result.path;
};

const buildSessionMetadata = (input: {
  errorLog?: string;
  errorLogFile?: string;
  goal: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  requireProfile?: boolean;
  runFix?: boolean;
  scope?: string;
  validate?: TaskSessionValidationOptions;
  workerId?: string;
}): Record<string, unknown> => ({
  errorLogFile: input.errorLogFile,
  goal: input.goal,
  hasErrorLog: Boolean(input.errorLog),
  scope: input.scope,
  workerId: input.workerId,
  requestedWorkerId: input.workerId,
  requireProfile: input.requireProfile ?? false,
  proposePatch: input.proposePatch ?? false,
  inspectPatch: input.inspectPatch ?? false,
  runFix: Boolean(input.runFix || input.errorLog || input.errorLogFile),
  validate: buildDefaultValidation(input.validate)
});

const deriveResumeOptions = (
  session: TaskSession,
  overrides: Pick<
    ResumeTaskSessionWorkflowInput,
    "applyPatch" | "errorLog" | "errorLogFile" | "inspectPatch" | "proposePatch" | "runFix"
  >
) => {
  const metadata = session.metadata as {
    errorLogFile?: string;
    inspectPatch?: boolean;
    proposePatch?: boolean;
    requestedWorkerId?: string;
    runFix?: boolean;
    validate?: TaskSessionValidationOptions;
  };

  return {
    errorLog: overrides.errorLog,
    errorLogFile: overrides.errorLogFile ?? metadata.errorLogFile,
    inspectPatch: overrides.inspectPatch ?? metadata.inspectPatch ?? false,
    proposePatch: overrides.proposePatch ?? metadata.proposePatch ?? false,
    requestedWorkerId: metadata.requestedWorkerId,
    runFix: overrides.runFix ?? metadata.runFix ?? false,
    validate: buildDefaultValidation(metadata.validate),
    applyPatch: overrides.applyPatch ?? false
  };
};

const buildSessionReport = (input: {
  artifactRegistryComplete?: boolean;
  artifactsReadable?: boolean;
  fixResult?: FixErrorWorkflowOutput;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryWriteMode?: "execute" | "dry-run";
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  rootDir?: string;
  sessionPersisted?: boolean;
  sessionWriteMode?: "execute" | "dry-run";
  session: TaskSession;
  validationReport?: ValidationReport;
  workspaceBinding?: WorkspaceBindingSummary;
}): string =>
  renderTaskSessionReport({
    session: input.session,
    repositoryContext: input.repositoryContext,
    reviewResult: input.reviewResult,
    fixResult: input.fixResult,
    validationReport: input.validationReport,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult,
    rootDir: input.rootDir,
    workspaceBinding: input.workspaceBinding,
    repositoryWriteMode: input.repositoryWriteMode,
    sessionWriteMode: input.sessionWriteMode,
    sessionPersisted: input.sessionPersisted,
    artifactsReadable: input.artifactsReadable,
    artifactRegistryComplete: input.artifactRegistryComplete
  });

const getRepositoryWriteMode = (
  context: ExecutionContext
): "execute" | "dry-run" =>
  context.dryRun || !context.allowWrite ? "dry-run" : "execute";

const getSessionWriteMode = (
  allowWriteSession: boolean
): "execute" | "dry-run" => (allowWriteSession ? "execute" : "dry-run");

const getExpectedArtifactNames = (input: {
  fixResult?: FixErrorWorkflowOutput;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  report: string;
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  validationReport?: ValidationReport;
}): string[] => {
  const artifactNames: string[] = [];

  if (input.repositoryContext) {
    artifactNames.push(ARTIFACT_NAMES.repositoryContext);
  }

  if (input.reviewResult) {
    artifactNames.push(ARTIFACT_NAMES.reviewResult);
  }

  if (input.validationReport) {
    artifactNames.push(ARTIFACT_NAMES.validationReport);
  }

  if (input.fixResult) {
    artifactNames.push(ARTIFACT_NAMES.fixResult);
  }

  if (input.patchProposal) {
    artifactNames.push(ARTIFACT_NAMES.patchProposal);
  }

  if (input.patchInspection) {
    artifactNames.push(ARTIFACT_NAMES.patchInspection);
  }

  if (input.patchApplyResult) {
    artifactNames.push(ARTIFACT_NAMES.patchApplyResult);
  }

  if (input.report.length > 0) {
    artifactNames.push(ARTIFACT_NAMES.report);
  }

  return Array.from(new Set(artifactNames));
};

const buildPersistenceState = (input: {
  expectedArtifactNames: string[];
  session: TaskSession;
  sessionWriteMode: "execute" | "dry-run";
}): TaskSessionPersistenceState => {
  const reportRegistered = Boolean(input.session.artifacts[ARTIFACT_NAMES.report]);
  const artifactRegistryComplete = input.expectedArtifactNames.every(
    (name) => Boolean(input.session.artifacts[name])
  );
  const sessionPersisted = input.sessionWriteMode === "execute";

  return {
    artifactRegistryComplete,
    artifactsReadable: sessionPersisted && artifactRegistryComplete,
    reportRegistered,
    resumable: sessionPersisted,
    sessionPersisted,
    storageKind: sessionPersisted ? "persisted" : "temporary"
  };
};

const buildReadinessSummary = (input: {
  persistence: TaskSessionPersistenceState;
  repositoryWriteMode: "execute" | "dry-run";
  validationReport?: ValidationReport;
}): string => {
  const persistenceSummary = input.persistence.sessionPersisted
    ? "Persisted task session is available for resume and artifact reads."
    : "This result is temporary only; it cannot be resumed or read back as persisted artifacts.";
  const repositoryWriteSummary =
    input.repositoryWriteMode === "execute"
      ? "Repository writes are enabled for explicit apply steps."
      : "Repository writes are still dry-run only.";
  const validationSummary = summarizeValidationOutcome(
    input.validationReport
  ).summary;

  return `${persistenceSummary} ${repositoryWriteSummary} ${validationSummary}`;
};

const buildNextRecommendedActions = (input: {
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  persistence: TaskSessionPersistenceState;
  session: TaskSession;
}): NextRecommendedAction[] => {
  const reportAction: NextRecommendedAction = input.persistence.sessionPersisted
    ? {
        action: "view_report",
        reason: "Read the persisted task report before taking the next step.",
        command: `cw task report ${input.session.taskId}`,
        toolName: "cw_get_task_report",
        toolArgs: {
          taskId: input.session.taskId
        }
      }
    : {
        action: "view_report",
        reason:
          "Review the inline report now. This session is temporary, so it cannot be resumed or read back later unless you rerun with session persistence enabled."
      };
  const persistenceAction = !input.persistence.sessionPersisted
    ? [
        {
          action: "persist_session" as const,
          reason:
            "Rerun this task with `--allow-write-session` if you want resumable sessions and readable artifacts in user-scoped cw storage."
        }
      ]
    : [];

  if (input.patchInspection && !input.patchInspection.ok) {
    return [
      {
        ...reportAction,
        reason:
          "Patch inspection denied the proposal. Review denied paths and warnings before regenerating or editing the patch."
      },
      ...persistenceAction
    ];
  }

  if (input.patchApplyResult?.recovery) {
    return [
      {
        ...reportAction,
        reason:
          "Patch application succeeded but validation failed. Review the recovery guidance before making any further repository changes."
      },
      ...persistenceAction
    ];
  }

  if (input.patchApplyResult && !input.patchApplyResult.applied) {
    if (
      input.patchApplyResult.errors.some((error) =>
        error.includes("--confirm-apply")
      )
    ) {
      return [
        reportAction,
        {
          action: "confirm_apply",
          reason:
            "The stored patch passed earlier gates but still requires explicit confirmation before writes are allowed.",
          command:
            `cw task resume ${input.session.taskId} --from-step patch-applied --apply-patch --allow-write --confirm-apply`,
          toolName: "cw_resume_task",
          toolArgs: {
            taskId: input.session.taskId,
            fromStep: "patch-applied",
            applyPatch: true,
            allowWrite: true,
            confirmApply: true
          }
        },
        ...persistenceAction
      ];
    }

    return [
      {
        ...reportAction,
        reason:
          "Patch application was denied by a safety gate. Review the report and resolve the blocking condition before retrying."
      },
      ...persistenceAction
    ];
  }

  if (
    input.patchProposal &&
    input.patchInspection?.ok &&
    !input.patchApplyResult
  ) {
    return [
      {
        ...reportAction,
        reason:
          "A reviewed patch proposal is ready for manual inspection before any apply attempt."
      },
      {
        action: "dry_run_apply",
        reason:
          "Dry-run the stored patch proposal first so deterministic checks can fail safely without repository writes.",
        command:
          `cw task resume ${input.session.taskId} --from-step patch-applied --apply-patch`,
        toolName: "cw_resume_task",
        toolArgs: {
          taskId: input.session.taskId,
          fromStep: "patch-applied",
          applyPatch: true
        }
      },
      {
        action: "confirm_apply",
        reason:
          "Only after manual review, rerun with explicit write gates to apply the stored patch proposal.",
        command:
          `cw task resume ${input.session.taskId} --from-step patch-applied --apply-patch --allow-write --confirm-apply`,
        toolName: "cw_resume_task",
        toolArgs: {
          taskId: input.session.taskId,
          fromStep: "patch-applied",
          applyPatch: true,
          allowWrite: true,
          confirmApply: true
          }
      },
      ...persistenceAction
    ];
  }

  if (!input.patchProposal && input.persistence.sessionPersisted) {
    return [
      reportAction,
      {
        action: "propose_patch",
        reason:
          "If the report looks good, continue into patch proposal and inspection from the stored session.",
        command:
          `cw task resume ${input.session.taskId} --propose-patch --inspect-patch`,
        toolName: "cw_resume_task",
        toolArgs: {
          taskId: input.session.taskId,
          proposePatch: true,
          inspectPatch: true
        }
      }
    ];
  }

  return [reportAction, ...persistenceAction];
};

const resolveFinalStatus = (input: {
  applyPatchRequested: boolean;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  reviewAccepted?: boolean;
  fixAccepted?: boolean;
  validationReport?: ValidationReport;
}): TaskSessionStatus => {
  if (input.reviewAccepted === false || input.fixAccepted === false) {
    return "needs-review";
  }

  if (input.applyPatchRequested) {
    if (!input.patchApplyResult) {
      return "needs-review";
    }

    if (!input.patchApplyResult.applied) {
      return "needs-review";
    }
  }

  if (input.patchInspection && !input.patchInspection.ok) {
    return "needs-review";
  }

  if (input.validationReport && !input.validationReport.ok) {
    return "needs-review";
  }

  return "completed";
};

const shouldRunStep = (
  session: TaskSession,
  stepId: TaskStepId,
  fromStep: TaskStepId | undefined
): boolean => {
  const index = STEP_IDS.indexOf(stepId);
  const fromIndex = fromStep ? STEP_IDS.indexOf(fromStep) : 0;
  if (index < fromIndex) {
    return false;
  }

  const existing = session.steps.find((step) => step.id === stepId);
  return existing?.status !== "success" || Boolean(fromStep);
};

const loadArtifact = async <T>(
  rootDir: string,
  taskId: string,
  artifactName: string,
  cwStorageDir?: string
): Promise<T | undefined> => {
  const artifact = await readTaskArtifact<T>(
    rootDir,
    taskId,
    artifactName,
    cwStorageDir
  );
  return artifact.exists ? (artifact.value as T) : undefined;
};

const createBaseContext = async (
  inputContext: ExecutionContext | undefined,
  overrides: {
    allowWrite?: boolean;
  } = {}
): Promise<ExecutionContext> =>
  inputContext ??
  resolveExecutionContext({
    cliOverrides: {
      allowWrite: overrides.allowWrite ?? false,
      dryRun: !(overrides.allowWrite ?? false)
    }
  });

const executeReviewStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  scope?: string;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
  workerId: string;
}): Promise<ReviewWorkflowOutput> => {
  markStepRunning(getStep(input.session, "reviewed"));
  const reviewResult = await runReviewWorkflow({
    context: input.context,
    scope: input.scope,
    validate: input.validate,
    workerId: input.workerId
  });
  await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.repositoryContext,
    reviewResult.repositoryContext,
    input.allowWriteSession
  );
  const reviewArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.reviewResult,
    reviewResult,
    input.allowWriteSession
  );
  finalizeStep(
    getStep(input.session, "reviewed"),
    reviewResult.accepted ? "success" : "failure",
    {
      artifactPath: reviewArtifactPath,
      warnings: reviewResult.warnings,
      errors: reviewResult.errors
    }
  );
  await settleTaskSessionState({
    allowWriteSession: input.allowWriteSession,
    context: input.context,
    session: input.session,
    successStatus: "running",
    succeeded: reviewResult.accepted
  });
  const validationArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.validationReport,
    reviewResult.validationReport,
    input.allowWriteSession
  );
  const validationWarnings = [
    ...reviewResult.validationReport.warnings,
    ...reviewResult.warnings
  ];
  finalizeStep(
    getStep(input.session, "validated"),
    reviewResult.validationReport.ok ? "success" : "failure",
    {
      artifactPath: validationArtifactPath,
      warnings: validationWarnings,
      errors: reviewResult.errors
    }
  );
  await settleTaskSessionState({
    allowWriteSession: input.allowWriteSession,
    context: input.context,
    session: input.session,
    successStatus: "running",
    succeeded: reviewResult.accepted && reviewResult.validationReport.ok
  });
  return reviewResult;
};

const denyRemainingExecutionSteps = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  reason: string;
  session: TaskSession;
  steps: TaskStepId[];
}): Promise<void> => {
  input.steps.forEach((stepId) => {
    const step = getStep(input.session, stepId);
    if (step.status === "pending" || step.status === "running") {
      finalizeStep(step, "denied", {
        warnings: [input.reason]
      });
    }
  });
  await syncSessionState(
    input.context,
    input.session,
    "needs-review",
    input.allowWriteSession
  );
};

const executeFixStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  scope?: string;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
  workerId: string;
}): Promise<FixErrorWorkflowOutput> => {
  const step = getStep(input.session, "fix-planned");
  markStepRunning(step);
  const fixResult = await runFixErrorWorkflow({
    context: input.context,
    errorLog: input.errorLog,
    errorLogFile: input.errorLogFile,
    scope: input.scope,
    validate: input.validate,
    workerId: input.workerId
  });
  const repositoryContextPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.repositoryContext,
    fixResult.repositoryContext,
    input.allowWriteSession
  );
  const validationArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.validationReport,
    fixResult.validationReport,
    input.allowWriteSession
  );
  const fixArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.fixResult,
    fixResult,
    input.allowWriteSession
  );
  input.session.artifacts[ARTIFACT_NAMES.repositoryContext] = repositoryContextPath;
  input.session.artifacts[ARTIFACT_NAMES.validationReport] = validationArtifactPath;
  finalizeStep(step, fixResult.accepted ? "success" : "failure", {
    artifactPath: fixArtifactPath,
    warnings: fixResult.warnings,
    errors: fixResult.errors
  });
  await settleTaskSessionState({
    allowWriteSession: input.allowWriteSession,
    context: input.context,
    session: input.session,
    successStatus: "running",
    succeeded: fixResult.accepted
  });
  return fixResult;
};

const shouldRunFixStep = (input: {
  errorLog?: string;
  errorLogFile?: string;
  runFix?: boolean;
}): boolean =>
  Boolean(input.runFix || input.errorLog || input.errorLogFile);

const executePatchProposalStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  errorLog?: string;
  fixResult?: FixErrorWorkflowOutput;
  goal: string;
  reviewResult: ReviewWorkflowOutput;
  session: TaskSession;
  validationReport?: ValidationReport;
  workerId?: string;
}): Promise<PatchProposalWorkflowOutput> => {
  const proposalStep = getStep(input.session, "patch-proposed");
  const inspectionStep = getStep(input.session, "patch-inspected");
  markStepRunning(proposalStep);
  markStepRunning(inspectionStep);
  const patchResult = await runPatchProposalWorkflow({
    context: input.context,
    errorLog: input.errorLog,
    fixResult: input.fixResult,
    goal: input.goal,
    scope: input.session.scope,
    repositoryContext:
      input.fixResult?.repositoryContext ?? input.reviewResult.repositoryContext,
    reviewResult: input.reviewResult,
    workerId: input.workerId,
    validationReport: input.validationReport,
    requireProfile: input.session.requireProfile
  });
  const proposalPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.patchProposal,
    patchResult.proposal,
    input.allowWriteSession
  );
  const inspectionPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.patchInspection,
    patchResult.inspection,
    input.allowWriteSession
  );
  const placeholderProposal = isPlaceholderPatchProposal({
    proposal: patchResult.proposal,
    inspection: patchResult.inspection,
    warnings: patchResult.warnings
  });
  finalizeStep(proposalStep, placeholderProposal ? "denied" : "success", {
    artifactPath: proposalPath,
    ...(placeholderProposal
      ? { errors: patchResult.inspection.blockedReasons }
      : {}),
    warnings: patchResult.warnings
  });
  finalizeStep(
    inspectionStep,
    patchResult.inspection.ok ? "success" : "denied",
    {
      artifactPath: inspectionPath,
      errors: patchResult.inspection.blockedReasons,
      warnings: patchResult.warnings
    }
  );
  input.session.artifacts[ARTIFACT_NAMES.patchInspection] = inspectionPath;
  await settleTaskSessionState({
    allowWriteSession: input.allowWriteSession,
    context: input.context,
    session: input.session,
    successStatus: "running",
    succeeded: patchResult.inspection.ok
  });
  return patchResult;
};

const executePatchApplyStep = async (input: {
  allowDirtyWorktree?: boolean;
  allowWrite?: boolean;
  allowWriteSession: boolean;
  confirmApply?: boolean;
  context: ExecutionContext;
  patchProposal: PatchProposal;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
}): Promise<PatchApplyResult> => {
  const step = getStep(input.session, "patch-applied");
  markStepRunning(step);
  const applyResult = await applyPatchProposal(input.context, input.patchProposal, {
    allowDirtyWorktree: input.allowDirtyWorktree,
    allowWrite: input.allowWrite,
    confirmApply: input.confirmApply,
    dryRun: !input.allowWrite,
    runValidation: input.validate,
    scope: input.session.scope
  });
  const artifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.patchApplyResult,
    applyResult,
    input.allowWriteSession
  );
  finalizeStep(
    step,
    applyResult.applied
      ? "success"
      : applyResult.mode === "denied"
        ? "denied"
        : "skipped",
    {
      artifactPath,
      errors: applyResult.errors,
      warnings: applyResult.warnings
    }
  );
  await settleTaskSessionState({
    allowWriteSession: input.allowWriteSession,
    context: input.context,
    session: input.session,
    successStatus: "completed",
    succeeded: applyResult.applied
  });
  return applyResult;
};

const hydrateWorkflowOutput = async (
  rootDir: string,
  session: TaskSession,
  cwStorageDir?: string
): Promise<{
  fixResult?: FixErrorWorkflowOutput;
  repositoryContext?: RepositoryContextPack;
  validationReport?: ValidationReport;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  report?: string;
  reviewResult?: ReviewWorkflowOutput;
}> => {
  const repositoryContext = await loadArtifact<RepositoryContextPack>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.repositoryContext,
    cwStorageDir
  );
  const reviewResult = await loadArtifact<ReviewWorkflowOutput>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.reviewResult,
    cwStorageDir
  );
  const validationReport = await loadArtifact<ValidationReport>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.validationReport,
    cwStorageDir
  );
  const fixResult = await loadArtifact<FixErrorWorkflowOutput>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.fixResult,
    cwStorageDir
  );
  const patchProposal = await loadArtifact<PatchProposal>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchProposal,
    cwStorageDir
  );
  const patchInspection = await loadArtifact<PatchInspection>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchInspection,
    cwStorageDir
  );
  const patchApplyResult = await loadArtifact<PatchApplyResult>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchApplyResult,
    cwStorageDir
  );
  const reportArtifact = await readTaskArtifact<string>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.report,
    cwStorageDir
  );

  return {
    repositoryContext: repositoryContext ?? reviewResult?.repositoryContext,
    reviewResult,
    validationReport: validationReport ?? reviewResult?.validationReport,
    fixResult,
    patchProposal,
    patchInspection,
    patchApplyResult,
    report: reportArtifact.exists && typeof reportArtifact.value === "string"
      ? reportArtifact.value
      : undefined
  };
};

const persistReport = async (
  context: ExecutionContext,
  session: TaskSession,
  report: string,
  allowWriteSession: boolean
): Promise<void> => {
  const artifactPath = await persistArtifact(
    context,
    session,
    ARTIFACT_NAMES.report,
    report,
    allowWriteSession
  );
  session.artifacts[ARTIFACT_NAMES.report] = artifactPath;
  await updateTaskSession(context, session, allowWriteSession);
};

const finalizeTaskWorkflowOutput = async (input: {
  allowWriteSession: boolean;
  applyPatchRequested: boolean;
  context: ExecutionContext;
  finalStatus: TaskSessionStatus;
  fixResult?: FixErrorWorkflowOutput;
  localClientRuntime?: LocalClientRuntimeSummary;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  reviewResult: ReviewWorkflowOutput;
  session: TaskSession;
  sessionPath: string;
  sessionWriteMode: "execute" | "dry-run";
  validationReport?: ValidationReport;
  workerId: string;
}): Promise<TaskSessionWorkflowOutput> => {
  const repositoryContext =
    input.repositoryContext ?? input.reviewResult.repositoryContext;
  const validationReport =
    input.validationReport ?? input.reviewResult.validationReport;
  const workspaceBinding = buildWorkspaceBindingSummary(input.context.rootDir);
  const repositoryWriteMode = getRepositoryWriteMode(input.context);
  const initialReport = buildSessionReport({
    session: input.session,
    reviewResult: input.reviewResult,
    repositoryContext,
    fixResult: input.fixResult,
    validationReport,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult,
    rootDir: input.context.rootDir,
    workspaceBinding,
    repositoryWriteMode,
    sessionWriteMode: input.sessionWriteMode,
    sessionPersisted: input.sessionWriteMode === "execute"
  });
  await persistReport(
    input.context,
    input.session,
    initialReport,
    input.allowWriteSession
  );
  const persistence = buildPersistenceState({
    session: input.session,
    sessionWriteMode: input.sessionWriteMode,
    expectedArtifactNames: getExpectedArtifactNames({
      reviewResult: input.reviewResult,
      repositoryContext,
      validationReport,
      fixResult: input.fixResult,
      patchProposal: input.patchProposal,
      patchInspection: input.patchInspection,
      patchApplyResult: input.patchApplyResult,
      report: initialReport
    })
  });
  const report = buildSessionReport({
    session: input.session,
    reviewResult: input.reviewResult,
    repositoryContext,
    fixResult: input.fixResult,
    validationReport,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult,
    rootDir: input.context.rootDir,
    workspaceBinding,
    repositoryWriteMode,
    sessionWriteMode: input.sessionWriteMode,
    sessionPersisted: persistence.sessionPersisted,
    artifactsReadable: persistence.artifactsReadable,
    artifactRegistryComplete: persistence.artifactRegistryComplete
  });

  if (report !== initialReport) {
    await persistReport(input.context, input.session, report, input.allowWriteSession);
  }

  await syncSessionState(
    input.context,
    input.session,
    input.finalStatus,
    input.allowWriteSession
  );

  const nextRecommendedActions = buildNextRecommendedActions({
    session: input.session,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult,
    persistence
  });
  const readinessSummary = buildReadinessSummary({
    persistence,
    repositoryWriteMode,
    validationReport
  });

  return {
    localClientRuntime: input.localClientRuntime,
    mode: input.sessionWriteMode,
    nextRecommendedActions,
    persistence,
    readinessSummary,
    session: input.session,
    sessionPath: input.sessionPath,
    repositoryWriteMode,
    rootDir: input.context.rootDir,
    sessionWriteMode: input.sessionWriteMode,
    transientNotice: persistence.sessionPersisted
      ? undefined
      : "Temporary result only. Rerun with --allow-write-session to resume later or read artifacts from user-scoped cw storage.",
    workerId: input.workerId,
    workspaceBinding,
    reviewResult: input.reviewResult,
    repositoryContext,
    validationReport,
    fixResult: input.fixResult,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult,
    report
  };
};

interface TaskSessionExecutionState {
  fixResult?: FixErrorWorkflowOutput;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  validationReport?: ValidationReport;
}

interface TaskSessionExecutionInput {
  allowDirtyWorktree?: boolean;
  allowWrite?: boolean;
  allowWriteSession: boolean;
  applyPatch?: boolean;
  confirmApply?: boolean;
  context: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  fromStep?: TaskStepId;
  goal: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  runFix?: boolean;
  scope?: string;
  session: TaskSession;
  state: TaskSessionExecutionState;
  validate: Required<TaskSessionValidationOptions>;
  workerId: string;
  requestedWorkerId?: string;
}

const buildReviewBlockReason = (
  reviewResult: ReviewWorkflowOutput
): string | undefined =>
  reviewResult.accepted
    ? undefined
    : `Review quality gate failed: ${reviewResult.qualityGate.reasons.join(" | ")}`;

const buildFixBlockReason = (
  fixResult: FixErrorWorkflowOutput | undefined
): string | undefined =>
  fixResult && !fixResult.accepted
    ? `Fix planning quality gate failed: ${[
        ...fixResult.analysisResult.qualityGate.reasons,
        ...fixResult.planResult.qualityGate.reasons
      ].join(" | ")}`
    : undefined;

const shouldExecuteTaskStep = (
  session: TaskSession,
  stepId: TaskStepId,
  fromStep: TaskStepId | undefined,
  existingValue: unknown
): boolean =>
  existingValue === undefined || (fromStep ? shouldRunStep(session, stepId, fromStep) : true);

const runTaskSessionExecution = async (
  input: TaskSessionExecutionInput
): Promise<{
  fixResult?: FixErrorWorkflowOutput;
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  reviewResult: ReviewWorkflowOutput;
  validationReport?: ValidationReport;
}> => {
  let repositoryContext = input.state.repositoryContext;
  let reviewResult = input.state.reviewResult;
  let validationReport = input.state.validationReport;
  let fixResult = input.state.fixResult;
  let patchProposal = input.state.patchProposal;
  let patchInspection = input.state.patchInspection;
  let patchApplyResult = input.state.patchApplyResult;

  if (
    shouldExecuteTaskStep(
      input.session,
      "reviewed",
      input.fromStep,
      reviewResult
    )
  ) {
    reviewResult = await executeReviewStep({
      context: input.context,
      session: input.session,
      scope: input.scope,
      validate: input.validate,
      allowWriteSession: input.allowWriteSession,
      workerId: input.workerId
    });
    repositoryContext = reviewResult.repositoryContext;
    validationReport = reviewResult.validationReport;
  }

  if (!reviewResult) {
    throw new AgentError(
      "TASK_REVIEW_ARTIFACT_MISSING",
      `Review artifact is missing for task ${input.session.taskId}.`,
      { taskId: input.session.taskId }
    );
  }

  const reviewBlockReason = buildReviewBlockReason(reviewResult);
  const wantsFixStep = shouldRunFixStep(input);

  if (
    reviewResult.accepted &&
    wantsFixStep &&
    shouldExecuteTaskStep(
      input.session,
      "fix-planned",
      input.fromStep,
      fixResult
    )
  ) {
    fixResult = await executeFixStep({
      context: input.context,
      session: input.session,
      scope: input.scope,
      validate: input.validate,
      errorLog: input.errorLog,
      errorLogFile: input.errorLogFile,
      allowWriteSession: input.allowWriteSession,
      workerId: input.workerId
    });
    repositoryContext = fixResult.repositoryContext;
    validationReport = fixResult.validationReport;
  } else if (reviewBlockReason) {
    await denyRemainingExecutionSteps({
      allowWriteSession: input.allowWriteSession,
      context: input.context,
      reason: reviewBlockReason,
      session: input.session,
      steps: ["fix-planned", "patch-proposed", "patch-inspected", "patch-applied"]
    });
  } else if (!wantsFixStep && !fixResult) {
    finalizeStep(getStep(input.session, "fix-planned"), "skipped");
  }

  const fixBlockReason = buildFixBlockReason(fixResult);
  const wantsPatchProposal = input.proposePatch || input.inspectPatch;

  if (
    reviewResult.accepted &&
    !fixBlockReason &&
    wantsPatchProposal &&
    (shouldExecuteTaskStep(
      input.session,
      "patch-proposed",
      input.fromStep,
      patchProposal
    ) ||
      shouldExecuteTaskStep(
        input.session,
        "patch-inspected",
        input.fromStep,
        patchInspection
      ))
  ) {
    const patchResult = await executePatchProposalStep({
      context: input.context,
      session: input.session,
      reviewResult,
      fixResult,
      goal: input.goal,
      errorLog: input.errorLog,
      validationReport,
      workerId: input.requestedWorkerId,
      allowWriteSession: input.allowWriteSession
    });
    patchProposal = patchResult.proposal;
    patchInspection = patchResult.inspection;
  } else if (fixBlockReason) {
    await denyRemainingExecutionSteps({
      allowWriteSession: input.allowWriteSession,
      context: input.context,
      reason: fixBlockReason,
      session: input.session,
      steps: ["patch-proposed", "patch-inspected", "patch-applied"]
    });
  } else if (!wantsPatchProposal && !patchProposal && !patchInspection) {
    finalizeStep(getStep(input.session, "patch-proposed"), "skipped");
    finalizeStep(getStep(input.session, "patch-inspected"), "skipped");
  }

  if (
    reviewResult.accepted &&
    !fixBlockReason &&
    input.applyPatch &&
    shouldExecuteTaskStep(
      input.session,
      "patch-applied",
      input.fromStep,
      patchApplyResult
    )
  ) {
    if (!patchProposal) {
      throw new AgentError(
        "TASK_PATCH_PROPOSAL_MISSING",
        input.fromStep
          ? "Patch application requires a previously stored patch proposal."
          : "Patch application requires a patch proposal artifact.",
        { taskId: input.session.taskId }
      );
    }

    patchApplyResult = await executePatchApplyStep({
      allowDirtyWorktree: input.allowDirtyWorktree,
      context: input.context,
      session: input.session,
      patchProposal,
      validate: input.validate,
      allowWrite: input.allowWrite,
      confirmApply: input.confirmApply,
      allowWriteSession: input.allowWriteSession
    });
  } else if (!input.applyPatch && !patchApplyResult) {
    finalizeStep(getStep(input.session, "patch-applied"), "skipped");
  }

  return {
    reviewResult,
    repositoryContext: repositoryContext ?? reviewResult.repositoryContext,
    validationReport: validationReport ?? reviewResult.validationReport,
    fixResult,
    patchProposal,
    patchInspection,
    patchApplyResult
  };
};

export const runTaskSessionWorkflow = async (
  input: TaskSessionWorkflowInput
): Promise<TaskSessionWorkflowOutput> => {
  const baseContext = await createBaseContext(input.context, {
    allowWrite: input.allowWrite
  });
  const resolved = await resolveWorkflowWorkerContext({
    activity: "task session execution",
    context: baseContext,
    requireProfile: input.requireProfile,
    workerId: input.workerId
  });
  const allowWriteSession = input.allowWriteSession ?? false;
  const sessionCreate = await createTaskSession(
    resolved.context,
    {
      goal: input.goal,
      scope: input.scope,
      workerId: resolved.workerId,
      requireProfile: input.requireProfile,
      metadata: buildSessionMetadata({
        errorLog: input.errorLog,
        errorLogFile: input.errorLogFile,
        goal: input.goal,
        scope: input.scope,
        workerId: resolved.requestedWorkerId,
        requireProfile: input.requireProfile,
        proposePatch: input.proposePatch,
        inspectPatch: input.inspectPatch,
        runFix: input.runFix,
        validate: input.validate
      })
    },
    allowWriteSession
  );
  const session = sessionCreate.session;
  const execution = await runTaskSessionExecution({
    allowDirtyWorktree: input.allowDirtyWorktree,
    allowWrite: input.allowWrite,
    allowWriteSession,
    applyPatch: input.applyPatch,
    confirmApply: input.confirmApply,
    context: resolved.context,
    errorLog: input.errorLog,
    errorLogFile: input.errorLogFile,
    goal: input.goal,
    inspectPatch: input.inspectPatch,
    proposePatch: input.proposePatch,
    runFix: input.runFix,
    scope: input.scope,
    session,
    state: {},
    validate: buildDefaultValidation(input.validate),
    workerId: resolved.workerId,
    requestedWorkerId: resolved.requestedWorkerId
  });
  const finalStatus = resolveFinalStatus({
    applyPatchRequested: input.applyPatch ?? false,
    patchApplyResult: execution.patchApplyResult,
    patchInspection: execution.patchInspection,
    reviewAccepted: execution.reviewResult.accepted,
    fixAccepted: execution.fixResult?.accepted,
    validationReport: execution.validationReport
  });
  return finalizeTaskWorkflowOutput({
    allowWriteSession,
    applyPatchRequested: input.applyPatch ?? false,
    context: resolved.context,
    finalStatus,
    fixResult: execution.fixResult,
    localClientRuntime: resolved.localClientRuntime,
    patchApplyResult: execution.patchApplyResult,
    patchInspection: execution.patchInspection,
    patchProposal: execution.patchProposal,
    repositoryContext: execution.repositoryContext,
    reviewResult: execution.reviewResult,
    session,
    sessionPath: sessionCreate.path,
    sessionWriteMode: sessionCreate.mode,
    validationReport: execution.validationReport,
    workerId: resolved.workerId
  });
};

export const resumeTaskSessionWorkflow = async (
  input: ResumeTaskSessionWorkflowInput
): Promise<TaskSessionWorkflowOutput> => {
  const baseContext = await createBaseContext(input.context, {
    allowWrite: input.allowWrite
  });
  const session = await readTaskSession(
    baseContext.rootDir,
    input.taskId,
    baseContext.cwStorageDir
  );

  if (!session) {
    throw new AgentError("TASK_SESSION_NOT_FOUND", `Task session ${input.taskId} was not found.`, {
      taskId: input.taskId
    });
  }

  const metadata = session.metadata as {
    requestedWorkerId?: string;
  };
  const resolved = await resolveWorkflowWorkerContext({
    activity: "task session execution",
    context: baseContext,
    requireProfile: session.requireProfile,
    workerId: metadata.requestedWorkerId
  });
  const options = deriveResumeOptions(session, input);
  const fromStep = normalizeStepId(input.fromStep);
  const hydrated = await hydrateWorkflowOutput(
    resolved.context.rootDir,
    session,
    resolved.context.cwStorageDir
  );
  const allowWriteSession = input.allowWriteSession ?? false;
  const execution = await runTaskSessionExecution({
    allowDirtyWorktree: input.allowDirtyWorktree,
    allowWrite: input.allowWrite,
    allowWriteSession,
    applyPatch: options.applyPatch,
    confirmApply: input.confirmApply,
    context: resolved.context,
    errorLog: options.errorLog,
    errorLogFile: options.errorLogFile,
    fromStep,
    goal: session.goal,
    inspectPatch: options.inspectPatch,
    proposePatch: options.proposePatch,
    runFix: options.runFix,
    scope: session.scope,
    session,
    state: hydrated,
    validate: options.validate,
    workerId: resolved.workerId,
    requestedWorkerId: options.requestedWorkerId
  });

  const sessionWriteMode = getSessionWriteMode(allowWriteSession);
  const finalStatus = resolveFinalStatus({
    applyPatchRequested: options.applyPatch,
    patchApplyResult: execution.patchApplyResult,
    patchInspection: execution.patchInspection,
    reviewAccepted: execution.reviewResult.accepted,
    fixAccepted: execution.fixResult?.accepted,
    validationReport: execution.validationReport
  });

  return finalizeTaskWorkflowOutput({
    allowWriteSession,
    applyPatchRequested: options.applyPatch,
    context: resolved.context,
    finalStatus,
    fixResult: execution.fixResult,
    localClientRuntime: resolved.localClientRuntime,
    patchApplyResult: execution.patchApplyResult,
    patchInspection: execution.patchInspection,
    patchProposal: execution.patchProposal,
    repositoryContext: execution.repositoryContext,
    reviewResult: execution.reviewResult,
    session,
    sessionPath: getTaskSessionPath(
      resolved.context.rootDir,
      session.taskId,
      resolved.context.cwStorageDir
    ),
    sessionWriteMode,
    validationReport: execution.validationReport,
    workerId: resolved.workerId
  });
};

export const getTaskSessionStatus = async (
  rootDir: string,
  taskId: string,
  cwStorageDir?: string
): Promise<TaskSession> => {
  const session = await readTaskSession(rootDir, taskId, cwStorageDir);

  if (!session) {
    throw new AgentError("TASK_SESSION_NOT_FOUND", `Task session ${taskId} was not found.`, {
      taskId
    });
  }

  return session;
};

export const getTaskSessionReport = async (
  rootDir: string,
  taskId: string,
  cwStorageDir?: string
): Promise<{ report: string; session: TaskSession }> => {
  const session = await getTaskSessionStatus(rootDir, taskId, cwStorageDir);
  const hydrated = await hydrateWorkflowOutput(rootDir, session, cwStorageDir);
  const report =
    hydrated.report ??
    buildSessionReport({
      session,
      reviewResult: hydrated.reviewResult,
      repositoryContext: hydrated.repositoryContext,
      fixResult: hydrated.fixResult,
      validationReport: hydrated.validationReport,
      patchProposal: hydrated.patchProposal,
      patchInspection: hydrated.patchInspection,
      patchApplyResult: hydrated.patchApplyResult,
      rootDir,
      workspaceBinding: buildWorkspaceBindingSummary(rootDir),
      sessionPersisted: true,
      sessionWriteMode: "execute",
      artifactsReadable: true,
      artifactRegistryComplete: Boolean(session.artifacts[ARTIFACT_NAMES.report])
    });

  return {
    session,
    report
  };
};

export const listStoredTaskSessions = async (
  rootDir: string,
  limit = 50,
  cwStorageDir?: string
): Promise<TaskSession[]> => listTaskSessions(rootDir, limit, cwStorageDir);
