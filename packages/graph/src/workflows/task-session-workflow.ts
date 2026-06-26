import {
  AgentError,
  buildWorkspaceBindingSummary,
  resolveExecutionContext,
  summarizeValidationOutcome,
  createExecutionContextWithWorkerModel,
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
} from "@agent-orchestrator/core";
import {
  ModelRouter,
  resolveWorkerModel,
  resolveWorkerProfile
} from "@agent-orchestrator/models";
import { applyPatchProposal } from "@agent-orchestrator/tools";

import {
  runFixErrorWorkflow,
  type FixErrorWorkflowOutput
} from "./fix-error-workflow.js";
import {
  runPatchProposalWorkflow,
  type PatchProposalWorkflowOutput
} from "./patch-proposal-workflow.js";
import {
  runReviewWorkflow,
  type ReviewWorkflowOutput
} from "./review-workflow.js";

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

interface ResolvedTaskContext {
  context: ExecutionContext;
  requestedWorkerId?: string;
  workerId: string;
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

const LEGACY_STEP_IDS: Record<string, TaskStepId> = {
  review: "reviewed",
  "propose-patch": "patch-proposed",
  "apply-patch": "patch-applied"
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

  const legacyStepId = LEGACY_STEP_IDS[value];
  if (legacyStepId) {
    return legacyStepId;
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

const resolveTaskContext = async (
  context: ExecutionContext,
  workerId: string | undefined,
  requireProfile: boolean | undefined
): Promise<ResolvedTaskContext> => {
  if (!workerId && !requireProfile) {
    return {
      context,
      requestedWorkerId: workerId,
      workerId: ModelRouter.deriveWorkerId(context.workerModel)
    };
  }

  const workerModelResolution = await resolveWorkerModel({
    context,
    workerId
  });
  const workerContext = createExecutionContextWithWorkerModel(
    context,
    workerModelResolution.modelConfig
  );

  await resolveWorkerProfile({
    context: workerContext,
    workerId: workerModelResolution.workerId,
    modelConfig: workerContext.workerModel,
    requireProfile
  });

  return {
    context: workerContext,
    requestedWorkerId: workerId,
    workerId: workerModelResolution.workerId
  };
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
        command: `ao task report ${input.session.taskId}`,
        toolName: "ao_get_task_report",
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
            "Rerun this task with `--allow-write-session` if you want resumable sessions and readable artifacts in user-scoped ao storage."
        }
      ]
    : [];

  if (input.patchInspection && !input.patchInspection.ok) {
    return [
      {
        ...reportAction,
        reason:
          "Patch inspection blocked the proposal. Review blocked paths and warnings before regenerating or editing the patch."
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
            `ao task resume ${input.session.taskId} --from-step patch-applied --apply-patch --allow-write --confirm-apply`,
          toolName: "ao_resume_task",
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
          "Patch application was blocked by a safety gate. Review the report and resolve the blocking condition before retrying."
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
          `ao task resume ${input.session.taskId} --from-step patch-applied --apply-patch`,
        toolName: "ao_resume_task",
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
          `ao task resume ${input.session.taskId} --from-step patch-applied --apply-patch --allow-write --confirm-apply`,
        toolName: "ao_resume_task",
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
          `ao task resume ${input.session.taskId} --propose-patch --inspect-patch`,
        toolName: "ao_resume_task",
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
  validationReport?: ValidationReport;
}): TaskSessionStatus => {
  if (input.applyPatchRequested) {
    if (!input.patchApplyResult) {
      return "blocked";
    }

    if (!input.patchApplyResult.applied) {
      return "blocked";
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
  aoStorageDir?: string
): Promise<T | undefined> => {
  const artifact = await readTaskArtifact<T>(
    rootDir,
    taskId,
    artifactName,
    aoStorageDir
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
}): Promise<ReviewWorkflowOutput> => {
  markStepRunning(getStep(input.session, "context-built"));
  markStepRunning(getStep(input.session, "reviewed"));
  markStepRunning(getStep(input.session, "validated"));
  await syncSessionState(
    input.context,
    input.session,
    "context-built",
    input.allowWriteSession
  );
  const reviewResult = await runReviewWorkflow({
    context: input.context,
    scope: input.scope,
    validate: input.validate
  });
  const repositoryContextPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.repositoryContext,
    reviewResult.repositoryContext,
    input.allowWriteSession
  );
  finalizeStep(getStep(input.session, "context-built"), "success", {
    artifactPath: repositoryContextPath,
    warnings: reviewResult.repositoryContext.warnings
  });
  await syncSessionState(
    input.context,
    input.session,
    "context-built",
    input.allowWriteSession
  );
  const reviewArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.reviewResult,
    reviewResult,
    input.allowWriteSession
  );
  finalizeStep(getStep(input.session, "reviewed"), "success", {
    artifactPath: reviewArtifactPath
  });
  await syncSessionState(
    input.context,
    input.session,
    "reviewed",
    input.allowWriteSession
  );
  const validationArtifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.validationReport,
    reviewResult.validationReport,
    input.allowWriteSession
  );
  finalizeStep(
    getStep(input.session, "validated"),
    reviewResult.validationReport.ok ? "success" : "failure",
    {
      artifactPath: validationArtifactPath,
      warnings: reviewResult.validationReport.warnings
    }
  );
  await syncSessionState(
    input.context,
    input.session,
    reviewResult.validationReport.ok ? "validated" : "reviewed",
    input.allowWriteSession
  );
  return reviewResult;
};

const shouldRunFixStep = (input: {
  errorLog?: string;
  errorLogFile?: string;
  runFix?: boolean;
}): boolean =>
  Boolean(input.runFix || input.errorLog || input.errorLogFile);

const executeFixStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  errorLog?: string;
  errorLogFile?: string;
  scope?: string;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
}): Promise<FixErrorWorkflowOutput> => {
  const step = getStep(input.session, "fix-planned");
  markStepRunning(step);
  const fixResult = await runFixErrorWorkflow({
    context: input.context,
    errorLog: input.errorLog,
    errorLogFile: input.errorLogFile,
    scope: input.scope,
    validate: input.validate
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
  finalizeStep(step, "success", {
    artifactPath: fixArtifactPath,
    warnings: fixResult.validationReport.warnings
  });
  await syncSessionState(
    input.context,
    input.session,
    "fix-planned",
    input.allowWriteSession
  );
  return fixResult;
};

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
  finalizeStep(proposalStep, "success", {
    artifactPath: proposalPath,
    warnings: patchResult.warnings
  });
  finalizeStep(
    inspectionStep,
    patchResult.inspection.ok ? "success" : "blocked",
    {
      artifactPath: inspectionPath,
      errors: patchResult.inspection.blockedReasons,
      warnings: patchResult.warnings
    }
  );
  input.session.artifacts[ARTIFACT_NAMES.patchInspection] = inspectionPath;
  await syncSessionState(
    input.context,
    input.session,
    "patch-proposed",
    input.allowWriteSession
  );
  await syncSessionState(
    input.context,
    input.session,
    patchResult.inspection.ok ? "patch-inspected" : "needs-review",
    input.allowWriteSession
  );
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
      : applyResult.mode === "blocked"
        ? "blocked"
        : "skipped",
    {
      artifactPath,
      errors: applyResult.errors,
      warnings: applyResult.warnings
    }
  );
  await syncSessionState(
    input.context,
    input.session,
    applyResult.applied ? "patch-applied" : "blocked",
    input.allowWriteSession
  );
  return applyResult;
};

const hydrateWorkflowOutput = async (
  rootDir: string,
  session: TaskSession,
  aoStorageDir?: string
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
    aoStorageDir
  );
  const reviewResult = await loadArtifact<ReviewWorkflowOutput>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.reviewResult,
    aoStorageDir
  );
  const validationReport = await loadArtifact<ValidationReport>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.validationReport,
    aoStorageDir
  );
  const fixResult = await loadArtifact<FixErrorWorkflowOutput>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.fixResult,
    aoStorageDir
  );
  const patchProposal = await loadArtifact<PatchProposal>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchProposal,
    aoStorageDir
  );
  const patchInspection = await loadArtifact<PatchInspection>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchInspection,
    aoStorageDir
  );
  const patchApplyResult = await loadArtifact<PatchApplyResult>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchApplyResult,
    aoStorageDir
  );
  const reportArtifact = await readTaskArtifact<string>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.report,
    aoStorageDir
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

export const runTaskSessionWorkflow = async (
  input: TaskSessionWorkflowInput
): Promise<TaskSessionWorkflowOutput> => {
  const baseContext = await createBaseContext(input.context, {
    allowWrite: input.allowWrite
  });
  const resolved = await resolveTaskContext(
    baseContext,
    input.workerId,
    input.requireProfile
  );
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
  const validation = buildDefaultValidation(input.validate);
  const reviewResult = await executeReviewStep({
    context: resolved.context,
    session,
    scope: input.scope,
    validate: validation,
    allowWriteSession
  });
  let fixResult: FixErrorWorkflowOutput | undefined;
  let patchResult: PatchProposalWorkflowOutput | undefined;
  let patchApplyResult: PatchApplyResult | undefined;

  if (shouldRunFixStep(input)) {
    fixResult = await executeFixStep({
      context: resolved.context,
      session,
      scope: input.scope,
      validate: validation,
      errorLog: input.errorLog,
      errorLogFile: input.errorLogFile,
      allowWriteSession
    });
  } else {
    finalizeStep(getStep(session, "fix-planned"), "skipped");
  }

  const repositoryContext =
    fixResult?.repositoryContext ?? reviewResult.repositoryContext;
  const validationReport =
    fixResult?.validationReport ?? reviewResult.validationReport;

  if (input.proposePatch || input.inspectPatch) {
    patchResult = await executePatchProposalStep({
      context: resolved.context,
      session,
      reviewResult,
      fixResult,
      goal: input.goal,
      errorLog: input.errorLog,
      validationReport,
      workerId: resolved.requestedWorkerId,
      allowWriteSession
    });
  } else {
    finalizeStep(getStep(session, "patch-proposed"), "skipped");
    finalizeStep(getStep(session, "patch-inspected"), "skipped");
  }

  if (input.applyPatch) {
    const proposal = patchResult?.proposal;
    if (!proposal) {
      throw new AgentError(
        "TASK_PATCH_PROPOSAL_MISSING",
        "Patch application requires a patch proposal artifact.",
        { taskId: session.taskId }
      );
    }

    patchApplyResult = await executePatchApplyStep({
      allowDirtyWorktree: input.allowDirtyWorktree,
      context: resolved.context,
      session,
      patchProposal: proposal,
      validate: validation,
      allowWrite: input.allowWrite,
      confirmApply: input.confirmApply,
      allowWriteSession
    });
  } else {
    finalizeStep(getStep(session, "patch-applied"), "skipped");
  }
  const finalStatus = resolveFinalStatus({
    applyPatchRequested: input.applyPatch ?? false,
    patchApplyResult,
    patchInspection: patchResult?.inspection,
    validationReport
  });
  await syncSessionState(
    resolved.context,
    session,
    finalStatus,
    allowWriteSession
  );
  const initialReport = buildSessionReport({
    session,
    reviewResult,
    repositoryContext,
    fixResult,
    validationReport,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult,
    rootDir: resolved.context.rootDir,
    workspaceBinding: buildWorkspaceBindingSummary(resolved.context.rootDir),
    repositoryWriteMode: getRepositoryWriteMode(resolved.context),
    sessionWriteMode: sessionCreate.mode,
    sessionPersisted: sessionCreate.mode === "execute"
  });
  await persistReport(resolved.context, session, initialReport, allowWriteSession);
  const persistence = buildPersistenceState({
    session,
    sessionWriteMode: sessionCreate.mode,
    expectedArtifactNames: getExpectedArtifactNames({
      reviewResult,
      repositoryContext,
      validationReport,
      fixResult,
      patchProposal: patchResult?.proposal,
      patchInspection: patchResult?.inspection,
      patchApplyResult,
      report: initialReport
    })
  });
  const workspaceBinding = buildWorkspaceBindingSummary(resolved.context.rootDir);
  const repositoryWriteMode = getRepositoryWriteMode(resolved.context);
  const report = buildSessionReport({
    session,
    reviewResult,
    repositoryContext,
    fixResult,
    validationReport,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult,
    rootDir: resolved.context.rootDir,
    workspaceBinding,
    repositoryWriteMode,
    sessionWriteMode: sessionCreate.mode,
    sessionPersisted: persistence.sessionPersisted,
    artifactsReadable: persistence.artifactsReadable,
    artifactRegistryComplete: persistence.artifactRegistryComplete
  });
  if (report !== initialReport) {
    await persistReport(resolved.context, session, report, allowWriteSession);
  }
  const nextRecommendedActions = buildNextRecommendedActions({
    session,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult,
    persistence
  });
  const readinessSummary = buildReadinessSummary({
    persistence,
    repositoryWriteMode,
    validationReport
  });

  return {
    mode: sessionCreate.mode,
    nextRecommendedActions,
    persistence,
    readinessSummary,
    session,
    sessionPath: sessionCreate.path,
    repositoryWriteMode,
    rootDir: resolved.context.rootDir,
    sessionWriteMode: sessionCreate.mode,
    transientNotice: persistence.sessionPersisted
      ? undefined
      : "Temporary result only. Rerun with --allow-write-session to resume later or read artifacts from user-scoped ao storage.",
    workerId: resolved.workerId,
    workspaceBinding,
    reviewResult,
    repositoryContext,
    validationReport,
    fixResult,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult,
    report
  };
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
    baseContext.aoStorageDir
  );

  if (!session) {
    throw new AgentError("TASK_SESSION_NOT_FOUND", `Task session ${input.taskId} was not found.`, {
      taskId: input.taskId
    });
  }

  const metadata = session.metadata as {
    requestedWorkerId?: string;
  };
  const resolved = await resolveTaskContext(
    baseContext,
    metadata.requestedWorkerId,
    session.requireProfile
  );
  const options = deriveResumeOptions(session, input);
  const fromStep = normalizeStepId(input.fromStep);
  let repositoryContext = await loadArtifact<RepositoryContextPack>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.repositoryContext,
    resolved.context.aoStorageDir
  );
  let reviewResult = await loadArtifact<ReviewWorkflowOutput>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.reviewResult,
    resolved.context.aoStorageDir
  );
  let validationReport = await loadArtifact<ValidationReport>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.validationReport,
    resolved.context.aoStorageDir
  );
  let fixResult = await loadArtifact<FixErrorWorkflowOutput>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.fixResult,
    resolved.context.aoStorageDir
  );
  let patchProposal = await loadArtifact<PatchProposal>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchProposal,
    resolved.context.aoStorageDir
  );
  let patchInspection = await loadArtifact<PatchInspection>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchInspection,
    resolved.context.aoStorageDir
  );
  let patchApplyResult = await loadArtifact<PatchApplyResult>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchApplyResult,
    resolved.context.aoStorageDir
  );

  if (shouldRunStep(session, "reviewed", fromStep)) {
    reviewResult = await executeReviewStep({
      context: resolved.context,
      session,
      scope: session.scope,
      validate: options.validate,
      allowWriteSession: input.allowWriteSession ?? false
    });
    repositoryContext = reviewResult.repositoryContext;
    validationReport = reviewResult.validationReport;
  }

  if (!reviewResult) {
    throw new AgentError(
      "TASK_REVIEW_ARTIFACT_MISSING",
      `Review artifact is missing for task ${session.taskId}.`,
      { taskId: session.taskId }
    );
  }

  if (shouldRunFixStep(options) && shouldRunStep(session, "fix-planned", fromStep)) {
    fixResult = await executeFixStep({
      context: resolved.context,
      session,
      scope: session.scope,
      validate: options.validate,
      errorLog: options.errorLog,
      errorLogFile: options.errorLogFile,
      allowWriteSession: input.allowWriteSession ?? false
    });
    repositoryContext = fixResult.repositoryContext;
    validationReport = fixResult.validationReport;
  }

  if ((options.proposePatch || options.inspectPatch) && shouldRunStep(session, "patch-proposed", fromStep)) {
    const patchResult = await executePatchProposalStep({
      context: resolved.context,
      session,
      reviewResult,
      fixResult,
      goal: session.goal,
      errorLog: options.errorLog,
      validationReport,
      workerId: options.requestedWorkerId,
      allowWriteSession: input.allowWriteSession ?? false
    });
    patchProposal = patchResult.proposal;
    patchInspection = patchResult.inspection;
  }

  if (options.applyPatch && shouldRunStep(session, "patch-applied", fromStep)) {
    if (!patchProposal) {
      throw new AgentError(
        "TASK_PATCH_PROPOSAL_MISSING",
        "Patch application requires a previously stored patch proposal.",
        { taskId: session.taskId }
      );
    }

    patchApplyResult = await executePatchApplyStep({
      allowDirtyWorktree: input.allowDirtyWorktree,
      context: resolved.context,
      session,
      patchProposal,
      validate: options.validate,
      allowWrite: input.allowWrite,
      confirmApply: input.confirmApply,
      allowWriteSession: input.allowWriteSession ?? false
    });
  }

  const initialReport = buildSessionReport({
    session,
    reviewResult,
    repositoryContext: repositoryContext ?? reviewResult.repositoryContext,
    fixResult,
    validationReport: validationReport ?? reviewResult.validationReport,
    patchProposal,
    patchInspection,
    patchApplyResult,
    rootDir: resolved.context.rootDir,
    workspaceBinding: buildWorkspaceBindingSummary(resolved.context.rootDir),
    repositoryWriteMode: getRepositoryWriteMode(resolved.context),
    sessionWriteMode: getSessionWriteMode(input.allowWriteSession ?? false),
    sessionPersisted: Boolean(input.allowWriteSession ?? false)
  });
  await persistReport(
    resolved.context,
    session,
    initialReport,
    input.allowWriteSession ?? false
  );
  const sessionWriteMode = getSessionWriteMode(input.allowWriteSession ?? false);
  const persistence = buildPersistenceState({
    session,
    sessionWriteMode,
    expectedArtifactNames: getExpectedArtifactNames({
      reviewResult,
      repositoryContext: repositoryContext ?? reviewResult.repositoryContext,
      validationReport: validationReport ?? reviewResult.validationReport,
      fixResult,
      patchProposal,
      patchInspection,
      patchApplyResult,
      report: initialReport
    })
  });
  const repositoryWriteMode = getRepositoryWriteMode(resolved.context);
  const workspaceBinding = buildWorkspaceBindingSummary(resolved.context.rootDir);
  const report = buildSessionReport({
    session,
    reviewResult,
    repositoryContext: repositoryContext ?? reviewResult.repositoryContext,
    fixResult,
    validationReport: validationReport ?? reviewResult.validationReport,
    patchProposal,
    patchInspection,
    patchApplyResult,
    rootDir: resolved.context.rootDir,
    workspaceBinding,
    repositoryWriteMode,
    sessionWriteMode,
    sessionPersisted: persistence.sessionPersisted,
    artifactsReadable: persistence.artifactsReadable,
    artifactRegistryComplete: persistence.artifactRegistryComplete
  });
  if (report !== initialReport) {
    await persistReport(
      resolved.context,
      session,
      report,
      input.allowWriteSession ?? false
    );
  }
  const nextRecommendedActions = buildNextRecommendedActions({
    session,
    patchProposal,
    patchInspection,
    patchApplyResult,
    persistence
  });
  const finalStatus = resolveFinalStatus({
    applyPatchRequested: options.applyPatch,
    patchApplyResult,
    patchInspection,
    validationReport: validationReport ?? reviewResult.validationReport
  });
  await syncSessionState(
    resolved.context,
    session,
    finalStatus,
    input.allowWriteSession ?? false
  );

  return {
    mode: sessionWriteMode,
    nextRecommendedActions,
    persistence,
    readinessSummary: buildReadinessSummary({
      persistence,
      repositoryWriteMode,
      validationReport: validationReport ?? reviewResult.validationReport
    }),
    session,
    sessionPath: getTaskSessionPath(
      resolved.context.rootDir,
      session.taskId,
      resolved.context.aoStorageDir
    ),
    repositoryWriteMode,
    rootDir: resolved.context.rootDir,
    sessionWriteMode,
    transientNotice: persistence.sessionPersisted
      ? undefined
      : "Temporary result only. Rerun with --allow-write-session to resume later or read artifacts from user-scoped ao storage.",
    workerId: resolved.workerId,
    workspaceBinding,
    reviewResult,
    repositoryContext: repositoryContext ?? reviewResult.repositoryContext,
    validationReport: validationReport ?? reviewResult.validationReport,
    fixResult,
    patchProposal,
    patchInspection,
    patchApplyResult,
    report
  };
};

export const getTaskSessionStatus = async (
  rootDir: string,
  taskId: string,
  aoStorageDir?: string
): Promise<TaskSession> => {
  const session = await readTaskSession(rootDir, taskId, aoStorageDir);

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
  aoStorageDir?: string
): Promise<{ report: string; session: TaskSession }> => {
  const session = await getTaskSessionStatus(rootDir, taskId, aoStorageDir);
  const hydrated = await hydrateWorkflowOutput(rootDir, session, aoStorageDir);
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
  aoStorageDir?: string
): Promise<TaskSession[]> => listTaskSessions(rootDir, limit, aoStorageDir);
