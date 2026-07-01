import type {
  AgentResult,
  ExecutionContext,
  RepositoryContextPack,
  WorkerCapabilityProfile,
  WorkerResultStatus,
  WorkerTaskType
} from "@mcp-code-worker/core";
import {
  resolveExecutionContext,
  ValidationReportSchema,
  writeAuditEvent
} from "@mcp-code-worker/core";
import {
  assessWorkerTaskEligibility
} from "@mcp-code-worker/models";
import { buildRepositoryContextPack } from "@mcp-code-worker/tools";

import { CodexHostAdapter } from "../host/codex-host-adapter.js";
import {
  runHostSemanticValidation,
  type HostSemanticFailureStage
} from "../validators/host-semantic-validator.js";
import { CodegenWorker } from "../workers/codegen-worker.js";
import { ReviewWorker } from "../workers/review-worker.js";
import { SummarizeWorker } from "../workers/summarize-worker.js";
import { TestWorker } from "../workers/test-worker.js";
import { resolveWorkflowWorkerContext } from "./worker-context-resolution.js";
import { resolveWorkerCapabilityProfileForExecution } from "./worker-onboarding-workflow.js";

export interface HostWorkerWorkflowInput {
  additionalTaskInput?: Record<string, unknown>;
  context?: ExecutionContext;
  files?: string[];
  forceExecution?: boolean;
  goal: string;
  repositoryContext?: RepositoryContextPack;
  requireProfile?: boolean;
  scope?: string;
  strictFiles?: boolean;
  taskType: Exclude<WorkerTaskType, "patch-generation">;
  workerCapabilityProfile?: WorkerCapabilityProfile | null;
  workerId?: string;
}

export type HostWorkerFailureStage =
  | "worker-blocked-by-policy"
  | "worker-not-run"
  | HostSemanticFailureStage
  | "worker-provider-failure"
  | "worker-json-parse-failure"
  | "worker-schema-validation-failure"
  | "unknown";

export type HostWorkerExecutionState =
  | "blocked_by_policy"
  | "not_executed"
  | "executed";

export type StructuredOutputStatus =
  | "not-attempted"
  | "valid"
  | "invalid";

export interface HostWorkerExecutionInfo {
  allowedByPolicy: boolean;
  forceExecution: boolean;
  overrideApplied: boolean;
  policyReason: string;
  requiresHostReview: boolean;
  state: HostWorkerExecutionState;
}

export interface HostWorkerWorkflowQualityGate {
  answered: boolean;
  answerStatus: "complete" | "incomplete";
  coverageGapDetected: boolean;
  execution: HostWorkerExecutionInfo;
  failureStages: HostWorkerFailureStage[];
  genericFallbackDetected: boolean;
  mentionedFiles: string[];
  missingRequestedFiles: string[];
  requiresHostReview: boolean;
  resultStatus: WorkerResultStatus;
  skippedFiles: string[];
  reasons: string[];
  structuredFailureKind:
    | "provider-invocation"
    | "json-parse"
    | "schema-validation"
    | null;
  structuredOutputAttempts: number;
  structuredOutputOk: boolean;
  structuredOutputStatus: StructuredOutputStatus;
  templateFallbackDetected: boolean;
  workflowStatus: "completed" | "needs_review";
}

export interface HostWorkerWorkflowOutput {
  debug: {
    qualityGate: {
      answerStatus: "complete" | "incomplete";
      coverageGapDetected: boolean;
      execution: HostWorkerExecutionInfo;
      failureStages: HostWorkerFailureStage[];
      reasons: string[];
      resultStatus: WorkerResultStatus;
      structuredFailureKind:
        | "provider-invocation"
        | "json-parse"
        | "schema-validation"
        | null;
      structuredOutputAttempts: number;
      structuredOutputOk: boolean;
      structuredOutputStatus: StructuredOutputStatus;
      workflowStatus: "completed" | "needs_review";
    };
    promptTransparency: {
      hostPrompt: string;
      promptTransformation: "preserved" | "augmented";
      workerPrompt: string | null;
    };
    repositoryContext: {
      requestedFiles: string[];
      skippedFiles: string[];
      scope?: string;
      selectedFiles: string[];
      coverageGapDetected: boolean;
      strictFiles: boolean;
      warnings: string[];
    };
    workerExecution: HostWorkerExecutionInfo;
    worker: {
      artifacts: AgentResult["artifacts"];
      metadata: Record<string, unknown>;
      output: unknown;
      status: AgentResult["status"];
    } | null;
  };
  execution: HostWorkerExecutionInfo;
  errors: string[];
  finalResult: AgentResult;
  qualityGate: HostWorkerWorkflowQualityGate;
  repositoryContext: RepositoryContextPack;
  warnings: string[];
  workerCapabilityProfile: WorkerCapabilityProfile | null;
  workerResult: AgentResult | null;
}

const asFailureKind = (
  value: unknown
):
  | "provider-invocation"
  | "json-parse"
  | "schema-validation"
  | null =>
  value === "provider-invocation" ||
  value === "json-parse" ||
  value === "schema-validation"
    ? value
    : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const getValidationReportFromInput = (input: HostWorkerWorkflowInput) => {
  const parsed = ValidationReportSchema.safeParse(
    input.additionalTaskInput?.validationReport
  );

  return parsed.success ? parsed.data : undefined;
};

const resolveWorkerResultStatus = (input: {
  execution: HostWorkerExecutionInfo;
  semanticStatus: WorkerResultStatus;
  structuredOutputOk: boolean;
  workerResult: AgentResult | null;
}): WorkerResultStatus => {
  if (input.execution.state === "blocked_by_policy") {
    return "blocked";
  }

  if (input.execution.state !== "executed") {
    return "host_takeover";
  }

  if (!input.structuredOutputOk || input.workerResult?.status === "failure") {
    return "invalid_output";
  }

  return input.semanticStatus;
};

const buildQualityGate = (
  input: HostWorkerWorkflowInput,
  repositoryContext: RepositoryContextPack,
  execution: HostWorkerExecutionInfo,
  workerResult: AgentResult | null
): HostWorkerWorkflowQualityGate => {
  const structuredOutputOk =
    workerResult?.metadata.structuredOutputOk === true;
  const structuredFailureKind = asFailureKind(workerResult?.metadata.failureKind);
  const structuredOutputAttempts =
    execution.state === "executed"
      ? asNumber(workerResult?.metadata.structuredOutputAttempts) ?? 0
      : 0;
  const structuredOutputStatus: StructuredOutputStatus =
    execution.state !== "executed"
      ? "not-attempted"
      : structuredOutputOk
        ? "valid"
        : "invalid";
  const semanticValidation = runHostSemanticValidation({
    executionState: execution.state,
    repositoryContext,
    requestedFiles: input.files ?? [],
    taskType: input.taskType,
    validationReport: getValidationReportFromInput(input),
    workerResult
  });
  const resultStatus = resolveWorkerResultStatus({
    execution,
    semanticStatus: semanticValidation.resultStatus,
    structuredOutputOk,
    workerResult
  });
  const reasons: string[] = [];
  const failureStages = new Set<HostWorkerFailureStage>();

  if (execution.state === "blocked_by_policy") {
    reasons.push(`Worker execution was blocked by policy: ${execution.policyReason}`);
    failureStages.add("worker-blocked-by-policy");
  } else if (execution.state !== "executed") {
    reasons.push("Worker was not executed.");
    failureStages.add("worker-not-run");
  }

  if (execution.state === "executed" && !structuredOutputOk) {
    if (structuredFailureKind === "provider-invocation") {
      reasons.push("Worker execution failed during provider invocation.");
      failureStages.add("worker-provider-failure");
    } else if (structuredFailureKind === "json-parse") {
      reasons.push("Worker executed but did not return parseable JSON.");
      failureStages.add("worker-json-parse-failure");
    } else {
      reasons.push("Worker executed but did not return schema-valid structured output.");
      failureStages.add("worker-schema-validation-failure");
    }
  }

  for (const issue of semanticValidation.issues) {
    reasons.push(issue.reason);
    failureStages.add(issue.stage);
  }

  if (
    failureStages.size === 0 &&
    execution.state === "executed" &&
    !structuredOutputOk
  ) {
    failureStages.add("unknown");
  }

  const answered = reasons.length === 0;
  const requiresHostReview =
    execution.requiresHostReview ||
    execution.state !== "executed" ||
    workerResult?.status !== "success" ||
    !answered;

  return {
    answered,
    answerStatus: answered ? "complete" : "incomplete",
    coverageGapDetected: semanticValidation.coverageGapDetected,
    execution,
    failureStages: Array.from(failureStages),
    genericFallbackDetected: semanticValidation.genericFallbackDetected,
    mentionedFiles: semanticValidation.mentionedFiles,
    missingRequestedFiles: semanticValidation.missingRequestedFiles,
    requiresHostReview,
    resultStatus,
    skippedFiles: semanticValidation.skippedFiles,
    reasons,
    structuredFailureKind,
    structuredOutputAttempts,
    structuredOutputOk,
    structuredOutputStatus,
    templateFallbackDetected: semanticValidation.templateFallbackDetected,
    workflowStatus: execution.state === "executed" ? "completed" : "needs_review"
  };
};

const resolveWorkerAgent = (
  taskType: HostWorkerWorkflowInput["taskType"],
  context: ExecutionContext
) => {
  switch (taskType) {
    case "summarization":
    case "log-analysis":
    case "json-extraction":
    case "doc-generation":
      return new SummarizeWorker(context);
    case "review-lite":
    case "risk-analysis":
    case "code-understanding":
      return new ReviewWorker(context);
    case "codegen":
    case "validation-fix":
      return new CodegenWorker(context);
    case "test-generation":
      return new TestWorker(context);
  }
};

const resolveProfile = async (
  input: HostWorkerWorkflowInput,
  workerContext: ExecutionContext,
  workerId: string
): Promise<{ profile: WorkerCapabilityProfile; warnings: string[] }> => {
  return resolveWorkerCapabilityProfileForExecution({
    providedProfile: input.workerCapabilityProfile,
    requireProfile: input.requireProfile,
    workerContext,
    workerId
  });
};

export const runHostWorkerWorkflow = async (
  input: HostWorkerWorkflowInput
): Promise<HostWorkerWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const resolvedWorker = await resolveWorkflowWorkerContext({
    activity: "host-managed worker execution",
    context,
    requireProfile: input.requireProfile,
    workerId: input.workerId
  });
  const resolvedWorkerId = resolvedWorker.workerId;
  const workerContext = resolvedWorker.context;
  const repositoryContext =
    input.repositoryContext ??
    await buildRepositoryContextPack(context, {
      rootDir: context.rootDir,
      scope: input.scope,
      files: input.files,
      strictFiles: input.strictFiles
    });
  const hostAdapter = new CodexHostAdapter();
  const hostTask = hostAdapter.buildWorkerTask({
    additionalTaskInput: input.additionalTaskInput,
    context: workerContext,
    goal: input.goal,
    repositoryContext,
    taskType: input.taskType
  });
  const task = hostTask.task;
  const hostPrompt = input.goal;

  await writeAuditEvent(context, {
    actor: "workflow",
    action: "start",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "host-worker-workflow",
    inputSummary: input.goal,
    outputSummary: "Host-managed worker workflow started.",
    warnings: repositoryContext.warnings,
    errors: [],
    metadata: {
      files: input.files ?? [],
      scope: repositoryContext.scope,
      taskType: input.taskType,
      workerId: resolvedWorkerId
    }
  });

  const { profile, warnings: profileWarnings } = await resolveProfile(
    input,
    workerContext,
    resolvedWorkerId
  );
  const eligibility = assessWorkerTaskEligibility(profile, input.taskType);
  const plannedTask = hostTask.plannedTask;
  const forceExecution = input.forceExecution === true;
  const overrideApplied = forceExecution && !eligibility.allowed;
  const execution: HostWorkerExecutionInfo = {
    allowedByPolicy: eligibility.allowed,
    forceExecution,
    overrideApplied,
    policyReason: eligibility.reason,
    requiresHostReview:
      eligibility.requiresHostReview || overrideApplied,
    state: eligibility.allowed || overrideApplied
      ? "executed"
      : "blocked_by_policy"
  };

  let workerResult: AgentResult | null = null;
  const warnings = [
    ...repositoryContext.warnings,
    ...profileWarnings
  ];
  const errors: string[] = [];

  if (!eligibility.allowed && !overrideApplied) {
    warnings.push(eligibility.reason);
  } else {
    if (overrideApplied) {
      warnings.push(
        `Policy override enabled for ${profile.workerId}; executing ${input.taskType} despite routing warning: ${eligibility.reason}`
      );
    }
    const worker = resolveWorkerAgent(input.taskType, workerContext);
    workerResult = await worker.execute({
      allowUnqualifiedExecution: overrideApplied,
      task,
      plannedTask,
      scope: repositoryContext.scope,
      workerProfile: profile,
      notes: [
        `Task type: ${input.taskType}`,
        `Requested files: ${(input.files ?? []).join(", ") || "none"}`,
        `Selected files: ${repositoryContext.selectedFiles.map((file) => file.path).join(", ") || "none"}`
      ]
    });
  }

  const qualityGate = buildQualityGate(
    input,
    repositoryContext,
    execution,
    workerResult
  );
  if (!qualityGate.answered) {
    warnings.push(...qualityGate.reasons);
  }

  const runSucceeded =
    execution.state === "executed" &&
    qualityGate.answered &&
    !qualityGate.requiresHostReview &&
    workerResult?.status === "success";
  const finalResult: AgentResult = {
    taskId: task.id,
    agentId: "host-worker.finalizer",
    role: "reviewer",
    status: runSucceeded ? "success" : "needs_review",
    output: {
      execution,
      qualityGate,
      repositoryContext: {
        scope: repositoryContext.scope,
        requestedFiles: repositoryContext.requestedFiles,
        skippedFiles: repositoryContext.skippedFiles,
        coverageGapDetected: repositoryContext.coverageGapDetected,
        selectedFiles: repositoryContext.selectedFiles.map((file) => file.path),
        strictFiles: repositoryContext.strictFiles
      },
      worker: workerResult?.output ?? null
    },
    confidence:
      runSucceeded && workerResult
        ? workerResult.confidence
        : 0.42,
    risks: [
      ...(workerResult?.risks ?? []),
      ...qualityGate.reasons
    ],
    artifacts: workerResult?.artifacts ?? [],
    metadata: {
      executionState: execution.state,
      forceExecution: execution.forceExecution,
      overrideApplied: execution.overrideApplied,
      taskType: input.taskType,
      workerId: profile.workerId
    }
  };

  await writeAuditEvent(context, {
    actor: "workflow",
    action: "complete",
    mode: context.dryRun ? "dry-run" : "execute",
    workflow: "host-worker-workflow",
    inputSummary: input.goal,
    outputSummary: `Host-managed worker workflow completed with status ${finalResult.status}.`,
    warnings,
    errors,
    metadata: {
      answered: qualityGate.answered,
      scope: repositoryContext.scope,
      taskType: input.taskType,
      workerId: profile.workerId
    }
  });

  return {
    debug: {
      qualityGate: {
        answerStatus: qualityGate.answerStatus,
        coverageGapDetected: qualityGate.coverageGapDetected,
        execution: qualityGate.execution,
        failureStages: qualityGate.failureStages,
        reasons: qualityGate.reasons,
        resultStatus: qualityGate.resultStatus,
        structuredFailureKind: qualityGate.structuredFailureKind,
        structuredOutputAttempts: qualityGate.structuredOutputAttempts,
        structuredOutputOk: qualityGate.structuredOutputOk,
        structuredOutputStatus: qualityGate.structuredOutputStatus,
        workflowStatus: qualityGate.workflowStatus
      },
      promptTransparency: {
        hostPrompt,
        promptTransformation: hostTask.promptTransformation,
        workerPrompt:
          typeof workerResult?.metadata.prompt === "string"
            ? workerResult.metadata.prompt
            : null
      },
      repositoryContext: {
        requestedFiles: repositoryContext.requestedFiles,
        skippedFiles: repositoryContext.skippedFiles,
        scope: repositoryContext.scope,
        selectedFiles: repositoryContext.selectedFiles.map((file) => file.path),
        coverageGapDetected: repositoryContext.coverageGapDetected,
        strictFiles: repositoryContext.strictFiles,
        warnings: repositoryContext.warnings
      },
      workerExecution: execution,
      worker: workerResult
        ? {
            artifacts: workerResult.artifacts,
            metadata: workerResult.metadata,
            output: workerResult.output,
            status: workerResult.status
          }
        : null
    },
    execution,
    errors,
    finalResult,
    qualityGate,
    repositoryContext,
    warnings,
    workerCapabilityProfile: profile,
    workerResult
  };
};
