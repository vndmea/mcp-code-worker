import { randomUUID } from "node:crypto";

import type {
  AgentResult,
  AgentTask,
  ExecutionContext,
  PlannedWorkerTask,
  RepositoryContextPack,
  WorkerCapabilityProfile,
  WorkerTaskType
} from "@agent-orchestrator/core";
import {
  resolveExecutionContext,
  createExecutionContextWithWorkerModel,
  writeAuditEvent
} from "@agent-orchestrator/core";
import {
  assessWorkerTaskEligibility,
  resolveWorkerModel,
  resolveWorkerProfile
} from "@agent-orchestrator/models";
import { buildRepositoryContextPack } from "@agent-orchestrator/tools";

import { CodegenWorker } from "../workers/codegen-worker.js";
import { ReviewWorker } from "../workers/review-worker.js";
import { SummarizeWorker } from "../workers/summarize-worker.js";
import { TestWorker } from "../workers/test-worker.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";

export interface HostWorkerWorkflowInput {
  additionalTaskInput?: Record<string, unknown>;
  context?: ExecutionContext;
  files?: string[];
  goal: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  repositoryContext?: RepositoryContextPack;
  requireProfile?: boolean;
  scope?: string;
  taskType: Exclude<WorkerTaskType, "patch-generation">;
  workerCapabilityProfile?: WorkerCapabilityProfile | null;
  workerId?: string;
}

export interface HostWorkerWorkflowQualityGate {
  answered: boolean;
  mentionedFiles: string[];
  missingRequestedFiles: string[];
  reasons: string[];
  structuredOutputOk: boolean;
  templateFallbackDetected: boolean;
}

export interface HostWorkerWorkflowOutput {
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
    input.taskType === "codegen"
      ? "patch-plan"
      : input.taskType === "test-generation"
        ? "test-plan"
        : input.taskType === "review-lite"
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
  priority: input.taskType === "codegen" ? "high" : "medium",
  metadata: {
    workflow: "host-worker-workflow"
  }
});

const detectTemplateFallback = (text: string): boolean =>
  /summarize-context|draft-implementation|plan-tests|scope not provided/iu.test(
    text
  );

const buildQualityGate = (
  input: HostWorkerWorkflowInput,
  repositoryContext: RepositoryContextPack,
  workerResult: AgentResult | null
): HostWorkerWorkflowQualityGate => {
  const selectedPaths = repositoryContext.selectedFiles.map((file) => file.path);
  const requestedPaths = input.files ?? [];
  const outputText = workerResult ? JSON.stringify(workerResult.output) : "";
  const mentionedFiles = selectedPaths.filter((path) => outputText.includes(path));
  const missingRequestedFiles = requestedPaths.filter(
    (path) => !selectedPaths.includes(path)
  );
  const structuredOutputOk =
    workerResult?.metadata.structuredOutputOk === true;
  const templateFallbackDetected = detectTemplateFallback(outputText);
  const reasons: string[] = [];

  if (!workerResult) {
    reasons.push("No worker result was produced.");
  }

  if (!structuredOutputOk) {
    reasons.push("Worker did not return validated structured output.");
  }

  if (missingRequestedFiles.length > 0) {
    reasons.push(
      `Requested files were not all included in repository context: ${missingRequestedFiles.join(", ")}.`
    );
  }

  if (selectedPaths.length > 0 && mentionedFiles.length === 0) {
    reasons.push("Worker answer did not reference any selected repository file.");
  }

  if (templateFallbackDetected) {
    reasons.push("Worker answer matched a known template fallback pattern.");
  }

  return {
    answered: reasons.length === 0,
    mentionedFiles,
    missingRequestedFiles,
    reasons,
    structuredOutputOk,
    templateFallbackDetected
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
      return new SummarizeWorker(context);
    case "review-lite":
      return new ReviewWorker(context);
    case "codegen":
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
  if (input.workerCapabilityProfile) {
    return {
      profile: input.workerCapabilityProfile,
      warnings:
        input.workerCapabilityProfile.status === "active"
          ? []
          : [
              `Worker ${input.workerCapabilityProfile.workerId} is ${input.workerCapabilityProfile.status}.`,
              ...input.workerCapabilityProfile.warnings
            ]
    };
  }

  const resolution = await resolveWorkerProfile({
    context: workerContext,
    modelConfig: workerContext.workerModel,
    workerId,
    requireProfile: input.requireProfile
  });

  if (resolution.freshness.usable && resolution.profile) {
    return {
      profile: resolution.profile,
      warnings:
        resolution.profile.status === "active"
          ? []
          : [
              `Worker ${resolution.profile.workerId} is ${resolution.profile.status}.`,
              ...resolution.profile.warnings
            ]
    };
  }

  const interviewResult = await runWorkerInterviewWorkflow({
    context: workerContext,
    workerId: resolution.workerId,
    modelConfig: workerContext.workerModel
  });

  const sourceWarning =
    resolution.source === "missing"
      ? `Worker profile for ${resolution.workerId} was missing; ran a fresh interview for this invocation.`
      : resolution.source === "stale"
        ? `Worker profile for ${resolution.workerId} was stale; ran a fresh interview for this invocation.`
        : resolution.source === "provider-error"
          ? `Worker profile for ${resolution.workerId} looked like a provider/configuration failure; ran a fresh interview for this invocation.`
          : `Worker profile for ${resolution.workerId} was incompatible with the current worker model; ran a fresh interview for this invocation.`;

  return {
    profile: interviewResult.profile,
    warnings: [sourceWarning, ...interviewResult.profile.warnings]
  };
};

export const runHostWorkerWorkflow = async (
  input: HostWorkerWorkflowInput
): Promise<HostWorkerWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const workerModelResolution = await resolveWorkerModel({
    context,
    workerId: input.workerId
  });
  const workerContext = createExecutionContextWithWorkerModel(
    context,
    workerModelResolution.modelConfig
  );
  const repositoryContext =
    input.repositoryContext ??
    await buildRepositoryContextPack(context, {
      rootDir: context.rootDir,
      scope: input.scope,
      files: input.files,
      maxFileBytes: input.maxFileBytes,
      maxTotalBytes: input.maxTotalBytes
    });
  const task = buildTask(input, repositoryContext);

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
      workerId: workerModelResolution.workerId
    }
  });

  const { profile, warnings: profileWarnings } = await resolveProfile(
    input,
    workerContext,
    workerModelResolution.workerId
  );
  const eligibility = assessWorkerTaskEligibility(profile, input.taskType);
  const plannedTask = createPlannedTask(input, repositoryContext);

  let workerResult: AgentResult | null = null;
  const warnings = [
    ...repositoryContext.warnings,
    ...workerModelResolution.warnings,
    ...profileWarnings
  ];
  const errors: string[] = [];

  if (!eligibility.allowed) {
    warnings.push(eligibility.reason);
  } else {
    const worker = resolveWorkerAgent(input.taskType, workerContext);
    workerResult = await worker.execute({
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

  const qualityGate = buildQualityGate(input, repositoryContext, workerResult);
  if (!qualityGate.answered) {
    warnings.push(...qualityGate.reasons);
  }

  const finalResult: AgentResult = {
    taskId: task.id,
    agentId: "host-worker.finalizer",
    role: "reviewer",
    status:
      eligibility.allowed && qualityGate.answered && workerResult?.status === "success"
        ? "success"
        : "needs_review",
    output: {
      qualityGate,
      repositoryContext: {
        scope: repositoryContext.scope,
        selectedFiles: repositoryContext.selectedFiles.map((file) => file.path)
      },
      worker: workerResult?.output ?? null
    },
    confidence:
      workerResult && qualityGate.answered
        ? workerResult.confidence
        : 0.42,
    risks: [
      ...(workerResult?.risks ?? []),
      ...qualityGate.reasons
    ],
    artifacts: workerResult?.artifacts ?? [],
    metadata: {
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
    errors,
    finalResult,
    qualityGate,
    repositoryContext,
    warnings,
    workerCapabilityProfile: profile,
    workerResult
  };
};
