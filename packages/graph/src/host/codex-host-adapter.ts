import { randomUUID } from "node:crypto";

import type {
  AgentTask,
  ExecutionContext,
  PlannedWorkerTask,
  RepositoryContextPack,
  WorkerTaskEnvelope,
  WorkerTaskType
} from "@mcp-code-worker/core";

import { getWorkerTaskContract } from "../contracts/worker-task-contract.js";

export interface CodexHostAdapterInput {
  additionalTaskInput?: Record<string, unknown>;
  context: ExecutionContext;
  goal: string;
  repositoryContext: RepositoryContextPack;
  taskId?: string;
  taskType: Exclude<WorkerTaskType, "patch-generation">;
}

export interface CodexHostAdapterOutput {
  envelope: WorkerTaskEnvelope;
  plannedTask: PlannedWorkerTask;
  promptTransformation: "augmented";
  task: AgentTask;
}

const priorityForTask = (
  taskType: Exclude<WorkerTaskType, "patch-generation">
): AgentTask["priority"] =>
  taskType === "codegen" || taskType === "validation-fix" ? "high" : "medium";

const expectedArtifactTypeForTask = (
  taskType: Exclude<WorkerTaskType, "patch-generation">
): PlannedWorkerTask["expectedArtifactType"] =>
  taskType === "codegen" || taskType === "validation-fix"
    ? "patch-plan"
    : taskType === "test-generation"
      ? "test-plan"
      : taskType === "review-lite" ||
          taskType === "risk-analysis" ||
          taskType === "code-understanding"
        ? "review"
        : "summary";

const riskLevelForTask = (
  taskType: Exclude<WorkerTaskType, "patch-generation">
): PlannedWorkerTask["riskLevel"] =>
  taskType === "codegen" || taskType === "validation-fix" ? "medium" : "low";

export class CodexHostAdapter {
  public buildWorkerTask(input: CodexHostAdapterInput): CodexHostAdapterOutput {
    const contract = getWorkerTaskContract(input.taskType);
    const taskId = input.taskId ?? randomUUID();
    const envelope = {
      id: taskId,
      taskType: input.taskType,
      objective: input.goal,
      host: "codex" as const,
      model: input.context.workerModel,
      constraints: [
        "Answer the user request directly.",
        "Use only the provided repository context.",
        "Reference concrete repository paths from the selected files."
      ],
      context: {
        repository: input.repositoryContext,
        scope: input.repositoryContext.scope
      },
      outputContract: {
        contractId: contract.capability.name,
        schemaVersion: contract.schemaVersion
      },
      trace: {
        createdAt: new Date().toISOString(),
        sourceWorkflow: "host-worker-workflow"
      }
    } satisfies WorkerTaskEnvelope;

    const task: AgentTask = {
      id: envelope.id,
      goal: envelope.objective,
      input: {
        ...(input.additionalTaskInput ?? {}),
        files: input.repositoryContext.requestedFiles,
        repositoryContext: input.repositoryContext,
        scope: input.repositoryContext.scope,
        taskType: input.taskType,
        workerTaskEnvelope: envelope
      },
      constraints: envelope.constraints,
      expectedOutput: "Direct worker answer grounded in the selected repository files.",
      assignedRole: "worker",
      priority: priorityForTask(input.taskType),
      metadata: {
        host: envelope.host,
        outputContractId: envelope.outputContract.contractId,
        outputContractVersion: envelope.outputContract.schemaVersion,
        workflow: "host-worker-workflow"
      }
    };

    const plannedTask: PlannedWorkerTask = {
      id: `host-${input.taskType}`,
      taskType: input.taskType,
      goal: input.goal,
      scope: input.repositoryContext.scope,
      riskLevel: riskLevelForTask(input.taskType),
      expectedArtifactType: expectedArtifactTypeForTask(input.taskType)
    };

    return {
      envelope,
      plannedTask,
      promptTransformation: "augmented",
      task
    };
  }
}
