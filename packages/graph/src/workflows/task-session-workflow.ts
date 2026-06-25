import {
  AgentError,
  createExecutionContextFromEnv,
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
  allowWrite?: boolean;
  allowWriteSession?: boolean;
  applyPatch?: boolean;
  confirmApply?: boolean;
  context?: ExecutionContext;
  goal: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  requireProfile?: boolean;
  scope?: string;
  validate?: TaskSessionValidationOptions;
  workerId?: string;
}

export interface ResumeTaskSessionWorkflowInput {
  allowWrite?: boolean;
  allowWriteSession?: boolean;
  applyPatch?: boolean;
  confirmApply?: boolean;
  context?: ExecutionContext;
  fromStep?: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  taskId: string;
}

export interface TaskSessionWorkflowOutput {
  mode: "execute" | "dry-run";
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  report: string;
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  session: TaskSession;
  sessionPath: string;
  validationReport?: ValidationReport;
  workerId: string;
}

interface ResolvedTaskContext {
  context: ExecutionContext;
  requestedWorkerId?: string;
  workerId: string;
}

const STEP_IDS = ["review", "propose-patch", "apply-patch"] as const;
type TaskStepId = (typeof STEP_IDS)[number];

const ARTIFACT_NAMES = {
  reviewResult: "review-result.json",
  patchProposal: "patch-proposal.json",
  patchInspection: "patch-inspection.json",
  patchApplyResult: "patch-apply-result.json",
  report: "report.md"
} as const;

const TASK_STEP_LABELS: Record<TaskStepId, string> = {
  review: "Repository review",
  "propose-patch": "Patch proposal",
  "apply-patch": "Patch apply"
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
  goal: string;
  inspectPatch?: boolean;
  proposePatch?: boolean;
  requireProfile?: boolean;
  scope?: string;
  validate?: TaskSessionValidationOptions;
  workerId?: string;
}): Record<string, unknown> => ({
  goal: input.goal,
  scope: input.scope,
  workerId: input.workerId,
  requestedWorkerId: input.workerId,
  requireProfile: input.requireProfile ?? false,
  proposePatch: input.proposePatch ?? false,
  inspectPatch: input.inspectPatch ?? false,
  validate: buildDefaultValidation(input.validate)
});

const deriveResumeOptions = (
  session: TaskSession,
  overrides: Pick<
    ResumeTaskSessionWorkflowInput,
    "inspectPatch" | "proposePatch" | "applyPatch"
  >
) => {
  const metadata = session.metadata as {
    inspectPatch?: boolean;
    proposePatch?: boolean;
    requestedWorkerId?: string;
    validate?: TaskSessionValidationOptions;
  };

  return {
    inspectPatch: overrides.inspectPatch ?? metadata.inspectPatch ?? false,
    proposePatch: overrides.proposePatch ?? metadata.proposePatch ?? false,
    requestedWorkerId: metadata.requestedWorkerId,
    validate: buildDefaultValidation(metadata.validate),
    applyPatch: overrides.applyPatch ?? false
  };
};

const buildSessionReport = (input: {
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  repositoryContext?: RepositoryContextPack;
  reviewResult?: ReviewWorkflowOutput;
  session: TaskSession;
  validationReport?: ValidationReport;
}): string =>
  renderTaskSessionReport({
    session: input.session,
    repositoryContext: input.repositoryContext,
    reviewResult: input.reviewResult,
    validationReport: input.validationReport,
    patchProposal: input.patchProposal,
    patchInspection: input.patchInspection,
    patchApplyResult: input.patchApplyResult
  });

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
  artifactName: string
): Promise<T | undefined> => {
  const artifact = await readTaskArtifact<T>(rootDir, taskId, artifactName);
  return artifact.exists ? (artifact.value as T) : undefined;
};

const createBaseContext = (
  inputContext: ExecutionContext | undefined,
  overrides: {
    allowWrite?: boolean;
  } = {}
): ExecutionContext =>
  inputContext ??
  createExecutionContextFromEnv(undefined, {
    allowWrite: overrides.allowWrite ?? false,
    dryRun: !(overrides.allowWrite ?? false)
  });

const executeReviewStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  scope?: string;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
}): Promise<ReviewWorkflowOutput> => {
  const step = getStep(input.session, "review");
  markStepRunning(step);
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
  const artifactPath = await persistArtifact(
    input.context,
    input.session,
    ARTIFACT_NAMES.reviewResult,
    reviewResult,
    input.allowWriteSession
  );
  finalizeStep(step, "success", {
    artifactPath
  });
  await syncSessionState(
    input.context,
    input.session,
    reviewResult.validationReport.ok ? "validated" : "reviewed",
    input.allowWriteSession
  );
  return reviewResult;
};

const executePatchProposalStep = async (input: {
  allowWriteSession: boolean;
  context: ExecutionContext;
  goal: string;
  reviewResult: ReviewWorkflowOutput;
  session: TaskSession;
  workerId?: string;
}): Promise<PatchProposalWorkflowOutput> => {
  const step = getStep(input.session, "propose-patch");
  markStepRunning(step);
  const patchResult = await runPatchProposalWorkflow({
      context: input.context,
      goal: input.goal,
      scope: input.session.scope,
      repositoryContext: input.reviewResult.repositoryContext,
      reviewResult: input.reviewResult,
      workerId: input.workerId,
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
  finalizeStep(step, patchResult.inspection.ok ? "success" : "blocked", {
    artifactPath: proposalPath,
    errors: patchResult.inspection.blockedReasons,
    warnings: patchResult.warnings
  });
  input.session.artifacts[ARTIFACT_NAMES.patchInspection] = inspectionPath;
  await syncSessionState(
    input.context,
    input.session,
    patchResult.inspection.ok ? "patch-inspected" : "needs-review",
    input.allowWriteSession
  );
  return patchResult;
};

const executePatchApplyStep = async (input: {
  allowWrite?: boolean;
  allowWriteSession: boolean;
  confirmApply?: boolean;
  context: ExecutionContext;
  patchProposal: PatchProposal;
  session: TaskSession;
  validate: TaskSessionValidationOptions;
}): Promise<PatchApplyResult> => {
  const step = getStep(input.session, "apply-patch");
  markStepRunning(step);
  const applyResult = await applyPatchProposal(input.context, input.patchProposal, {
    allowWrite: input.allowWrite,
    confirmApply: input.confirmApply,
    dryRun: !input.allowWrite,
    runValidation: input.validate
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
  session: TaskSession
): Promise<{
  patchApplyResult?: PatchApplyResult;
  patchInspection?: PatchInspection;
  patchProposal?: PatchProposal;
  report?: string;
  reviewResult?: ReviewWorkflowOutput;
}> => {
  const reviewResult = await loadArtifact<ReviewWorkflowOutput>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.reviewResult
  );
  const patchProposal = await loadArtifact<PatchProposal>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchProposal
  );
  const patchInspection = await loadArtifact<PatchInspection>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchInspection
  );
  const patchApplyResult = await loadArtifact<PatchApplyResult>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchApplyResult
  );
  const reportArtifact = await readTaskArtifact<string>(
    rootDir,
    session.taskId,
    ARTIFACT_NAMES.report
  );

  return {
    reviewResult,
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
};

export const runTaskSessionWorkflow = async (
  input: TaskSessionWorkflowInput
): Promise<TaskSessionWorkflowOutput> => {
  const baseContext = createBaseContext(input.context, {
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
        goal: input.goal,
        scope: input.scope,
        workerId: resolved.requestedWorkerId,
        requireProfile: input.requireProfile,
        proposePatch: input.proposePatch,
        inspectPatch: input.inspectPatch,
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
  let patchResult: PatchProposalWorkflowOutput | undefined;
  let patchApplyResult: PatchApplyResult | undefined;

  if (input.proposePatch || input.inspectPatch) {
    patchResult = await executePatchProposalStep({
      context: resolved.context,
      session,
      reviewResult,
      goal: input.goal,
      workerId: resolved.requestedWorkerId,
      allowWriteSession
    });
  } else {
    const step = getStep(session, "propose-patch");
    finalizeStep(step, "skipped");
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
      context: resolved.context,
      session,
      patchProposal: proposal,
      validate: validation,
      allowWrite: input.allowWrite,
      confirmApply: input.confirmApply,
      allowWriteSession
    });
  } else {
    const step = getStep(session, "apply-patch");
    finalizeStep(step, "skipped");
  }

  const finalStatus = resolveFinalStatus({
    applyPatchRequested: input.applyPatch ?? false,
    patchApplyResult,
    patchInspection: patchResult?.inspection,
    validationReport: reviewResult.validationReport
  });
  await syncSessionState(
    resolved.context,
    session,
    finalStatus,
    allowWriteSession
  );
  const report = buildSessionReport({
    session,
    reviewResult,
    repositoryContext: reviewResult.repositoryContext,
    validationReport: reviewResult.validationReport,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult
  });
  await persistReport(resolved.context, session, report, allowWriteSession);

  return {
    mode: sessionCreate.mode,
    session,
    sessionPath: sessionCreate.path,
    workerId: resolved.workerId,
    reviewResult,
    repositoryContext: reviewResult.repositoryContext,
    validationReport: reviewResult.validationReport,
    patchProposal: patchResult?.proposal,
    patchInspection: patchResult?.inspection,
    patchApplyResult,
    report
  };
};

export const resumeTaskSessionWorkflow = async (
  input: ResumeTaskSessionWorkflowInput
): Promise<TaskSessionWorkflowOutput> => {
  const baseContext = createBaseContext(input.context, {
    allowWrite: input.allowWrite
  });
  const session = await readTaskSession(baseContext.rootDir, input.taskId);

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
  let reviewResult = await loadArtifact<ReviewWorkflowOutput>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.reviewResult
  );
  let patchProposal = await loadArtifact<PatchProposal>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchProposal
  );
  let patchInspection = await loadArtifact<PatchInspection>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchInspection
  );
  let patchApplyResult = await loadArtifact<PatchApplyResult>(
    resolved.context.rootDir,
    session.taskId,
    ARTIFACT_NAMES.patchApplyResult
  );

  if (shouldRunStep(session, "review", fromStep)) {
    reviewResult = await executeReviewStep({
      context: resolved.context,
      session,
      scope: session.scope,
      validate: options.validate,
      allowWriteSession: input.allowWriteSession ?? false
    });
  }

  if (!reviewResult) {
    throw new AgentError(
      "TASK_REVIEW_ARTIFACT_MISSING",
      `Review artifact is missing for task ${session.taskId}.`,
      { taskId: session.taskId }
    );
  }

  if ((options.proposePatch || options.inspectPatch) && shouldRunStep(session, "propose-patch", fromStep)) {
    const patchResult = await executePatchProposalStep({
      context: resolved.context,
      session,
      reviewResult,
      goal: session.goal,
      workerId: options.requestedWorkerId,
      allowWriteSession: input.allowWriteSession ?? false
    });
    patchProposal = patchResult.proposal;
    patchInspection = patchResult.inspection;
  }

  if (options.applyPatch && shouldRunStep(session, "apply-patch", fromStep)) {
    if (!patchProposal) {
      throw new AgentError(
        "TASK_PATCH_PROPOSAL_MISSING",
        "Patch application requires a previously stored patch proposal.",
        { taskId: session.taskId }
      );
    }

    patchApplyResult = await executePatchApplyStep({
      context: resolved.context,
      session,
      patchProposal,
      validate: options.validate,
      allowWrite: input.allowWrite,
      confirmApply: input.confirmApply,
      allowWriteSession: input.allowWriteSession ?? false
    });
  }

  const report = buildSessionReport({
    session,
    reviewResult,
    repositoryContext: reviewResult.repositoryContext,
    validationReport: reviewResult.validationReport,
    patchProposal,
    patchInspection,
    patchApplyResult
  });
  await persistReport(
    resolved.context,
    session,
    report,
    input.allowWriteSession ?? false
  );
  const finalStatus = resolveFinalStatus({
    applyPatchRequested: options.applyPatch,
    patchApplyResult,
    patchInspection,
    validationReport: reviewResult.validationReport
  });
  await syncSessionState(
    resolved.context,
    session,
    finalStatus,
    input.allowWriteSession ?? false
  );

  return {
    mode:
      input.allowWriteSession && !resolved.context.dryRun
        ? "execute"
        : "dry-run",
    session,
    sessionPath: getTaskSessionPath(resolved.context.rootDir, session.taskId),
    workerId: resolved.workerId,
    reviewResult,
    repositoryContext: reviewResult.repositoryContext,
    validationReport: reviewResult.validationReport,
    patchProposal,
    patchInspection,
    patchApplyResult,
    report
  };
};

export const getTaskSessionStatus = async (
  rootDir: string,
  taskId: string
): Promise<TaskSession> => {
  const session = await readTaskSession(rootDir, taskId);

  if (!session) {
    throw new AgentError("TASK_SESSION_NOT_FOUND", `Task session ${taskId} was not found.`, {
      taskId
    });
  }

  return session;
};

export const getTaskSessionReport = async (
  rootDir: string,
  taskId: string
): Promise<{ report: string; session: TaskSession }> => {
  const session = await getTaskSessionStatus(rootDir, taskId);
  const hydrated = await hydrateWorkflowOutput(rootDir, session);
  const report =
    hydrated.report ??
    buildSessionReport({
      session,
      reviewResult: hydrated.reviewResult,
      repositoryContext: hydrated.reviewResult?.repositoryContext,
      validationReport: hydrated.reviewResult?.validationReport,
      patchProposal: hydrated.patchProposal,
      patchInspection: hydrated.patchInspection,
      patchApplyResult: hydrated.patchApplyResult
    });

  return {
    session,
    report
  };
};

export const listStoredTaskSessions = async (
  rootDir: string,
  limit = 50
): Promise<TaskSession[]> => listTaskSessions(rootDir, limit);
