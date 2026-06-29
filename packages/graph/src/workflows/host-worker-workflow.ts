import { randomUUID } from "node:crypto";

import type {
  AgentResult,
  AgentTask,
  ExecutionContext,
  PlannedWorkerTask,
  RepositoryContextPack,
  WorkerCapabilityProfile,
  WorkerTaskType
} from "@mcp-code-worker/core";
import {
  resolveExecutionContext,
  writeAuditEvent
} from "@mcp-code-worker/core";
import {
  assessWorkerTaskEligibility
} from "@mcp-code-worker/models";
import { buildRepositoryContextPack } from "@mcp-code-worker/tools";

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
  | "missing-requested-files"
  | "coverage-gap"
  | "missing-file-citations"
  | "template-fallback"
  | "generic-fallback"
  | "review-answer-missing"
  | "review-findings-insufficient"
  | "review-findings-missing-file-citations"
  | "review-file-reference-missing"
  | "review-file-reference-out-of-scope"
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

const createPlannedTask = (
  input: HostWorkerWorkflowInput,
  repositoryContext: RepositoryContextPack
): PlannedWorkerTask => ({
  id: `host-${input.taskType}`,
  taskType: input.taskType,
  goal: input.goal,
  scope: repositoryContext.scope,
  riskLevel: input.taskType === "codegen" ? "medium" : "low",
  expectedArtifactType:
    input.taskType === "codegen" || input.taskType === "validation-fix"
      ? "patch-plan"
      : input.taskType === "test-generation"
        ? "test-plan"
        : input.taskType === "review-lite" ||
            input.taskType === "risk-analysis" ||
            input.taskType === "code-understanding"
          ? "review"
          : "summary"
});

const buildTask = (
  input: HostWorkerWorkflowInput,
  repositoryContext: RepositoryContextPack
): AgentTask => ({
  id: randomUUID(),
  goal: input.goal,
  input: {
    ...(input.additionalTaskInput ?? {}),
    files: input.files ?? [],
    repositoryContext,
    scope: repositoryContext.scope,
    taskType: input.taskType
  },
  constraints: [
    "Answer the user request directly.",
    "Use only the provided repository context.",
    "Reference concrete repository paths from the selected files."
  ],
  expectedOutput: "Direct worker answer grounded in the selected repository files.",
  assignedRole: "worker",
  priority:
    input.taskType === "codegen" || input.taskType === "validation-fix"
      ? "high"
      : "medium",
  metadata: {
    workflow: "host-worker-workflow"
  }
});

const detectTemplateFallback = (text: string): boolean =>
  /summarize-context|draft-implementation|plan-tests|scope not provided/iu.test(
    text
  );

const detectGenericFallback = (text: string): boolean =>
  /review the files|inspect the code|depends on context|needs more context|check the implementation|candidate patch/iu.test(
    text
  );

const asOutputRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

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

const buildQualityGate = (
  input: HostWorkerWorkflowInput,
  repositoryContext: RepositoryContextPack,
  execution: HostWorkerExecutionInfo,
  workerResult: AgentResult | null
): HostWorkerWorkflowQualityGate => {
  const selectedPaths = repositoryContext.selectedFiles.map((file) => file.path);
  const requestedPaths = input.files ?? [];
  const skippedFiles = repositoryContext.skippedFiles ?? [];
  const outputText = workerResult ? JSON.stringify(workerResult.output) : "";
  const outputRecord = asOutputRecord(workerResult?.output);
  const mentionedFiles = selectedPaths.filter((path) => outputText.includes(path));
  const missingRequestedFiles = requestedPaths.filter(
    (path) => !selectedPaths.includes(path)
  );
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
  const templateFallbackDetected = detectTemplateFallback(outputText);
  const genericFallbackDetected =
    (
      input.taskType === "review-lite" ||
      input.taskType === "risk-analysis" ||
      input.taskType === "code-understanding"
    ) && detectGenericFallback(outputText);
  const coverageGapDetected =
    repositoryContext.coverageGapDetected === true || skippedFiles.length > 0;
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

  if (missingRequestedFiles.length > 0) {
    reasons.push(
      `Requested files were not all included in repository context: ${missingRequestedFiles.join(", ")}.`
    );
    failureStages.add("missing-requested-files");
  }

  if (coverageGapDetected) {
    reasons.push(
      `Repository context skipped candidate files and may be incomplete: ${skippedFiles.join(", ") || "unknown skipped files"}.`
    );
    failureStages.add("coverage-gap");
  }

  if (
    execution.state === "executed" &&
    selectedPaths.length > 0 &&
    mentionedFiles.length === 0
  ) {
    reasons.push("Worker answer did not reference any selected repository file.");
    failureStages.add("missing-file-citations");
  }

  if (execution.state === "executed" && templateFallbackDetected) {
    reasons.push("Worker answer matched a known template fallback pattern.");
    failureStages.add("template-fallback");
  }

  if (execution.state === "executed" && genericFallbackDetected) {
    reasons.push("Worker answer fell back to generic wording instead of a concrete repository answer.");
    failureStages.add("generic-fallback");
  }

  if (
    execution.state === "executed" &&
    (
      input.taskType === "review-lite" ||
      input.taskType === "risk-analysis" ||
      input.taskType === "code-understanding"
    )
  ) {
    const answer =
      outputRecord && typeof outputRecord.answer === "string"
        ? outputRecord.answer
        : "";
    const findings = asStringArray(outputRecord?.findings);
    const referencedFiles = asStringArray(outputRecord?.referencedFiles);
    const findingsMissingFileCitations =
      selectedPaths.length > 0 &&
      findings.some(
        (finding) => !selectedPaths.some((path) => finding.includes(path))
      );
    const outOfScopeReferences = referencedFiles.filter(
      (file) => !selectedPaths.includes(file)
    );

    if (!answer) {
      reasons.push("Review worker did not provide a direct answer field.");
      failureStages.add("review-answer-missing");
    }

    if (
      selectedPaths.length > 0 &&
      !referencedFiles.some((file) => selectedPaths.includes(file))
    ) {
      reasons.push("Review worker did not reference the selected files explicitly.");
      failureStages.add("review-file-reference-missing");
    }

    if (findingsMissingFileCitations) {
      reasons.push("Review worker findings did not cite selected repository files in every finding.");
      failureStages.add("review-findings-missing-file-citations");
    }

    if (selectedPaths.length > 0 && outOfScopeReferences.length > 0) {
      reasons.push(
        `Review worker referenced files outside the selected repository context: ${outOfScopeReferences.join(", ")}.`
      );
      failureStages.add("review-file-reference-out-of-scope");
    }
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
    coverageGapDetected,
    execution,
    failureStages: Array.from(failureStages),
    genericFallbackDetected,
    mentionedFiles,
    missingRequestedFiles,
    requiresHostReview,
    skippedFiles,
    reasons,
    structuredFailureKind,
    structuredOutputAttempts,
    structuredOutputOk,
    structuredOutputStatus,
    templateFallbackDetected,
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
  const task = buildTask(input, repositoryContext);
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
  const plannedTask = createPlannedTask(input, repositoryContext);
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
        structuredFailureKind: qualityGate.structuredFailureKind,
        structuredOutputAttempts: qualityGate.structuredOutputAttempts,
        structuredOutputOk: qualityGate.structuredOutputOk,
        structuredOutputStatus: qualityGate.structuredOutputStatus,
        workflowStatus: qualityGate.workflowStatus
      },
      promptTransparency: {
        hostPrompt,
        promptTransformation: "augmented",
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
