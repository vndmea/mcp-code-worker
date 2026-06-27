import type {
  AgentResult,
  AgentTask,
  ExecutionContext,
  PlannedWorkerTask,
  RepositoryContextPack,
  WorkerCapability,
  WorkerCapabilityProfile
} from "@agent-orchestrator/core";
import { ModelRouter, invokeStructured } from "@agent-orchestrator/models";
import type { ZodType } from "zod";

export interface WorkerExecutionInput {
  notes?: string[];
  plannedTask?: PlannedWorkerTask;
  scope?: string;
  task: AgentTask;
  workerProfile?: WorkerCapabilityProfile | null;
}

export interface WorkerResultOptions<T> {
  debugLabel?: string;
  agentId: string;
  task: AgentTask;
  prompt: string;
  outputSchema: ZodType<T>;
  fallbackOutput: T;
  risks: string[];
  confidence: number;
  artifacts?: AgentResult["artifacts"];
  workerProfile?: WorkerCapabilityProfile | null;
}

interface TaskInputWithRepositoryContext {
  repositoryContext?: RepositoryContextPack;
}

const asTaskInputWithRepositoryContext = (
  value: unknown
): TaskInputWithRepositoryContext =>
  value && typeof value === "object"
    ? (value as TaskInputWithRepositoryContext)
    : {};

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

export const getRepositoryContextFromTask = (
  task: AgentTask
): RepositoryContextPack | null =>
  asTaskInputWithRepositoryContext(task.input).repositoryContext ?? null;

export const buildRepositoryContextPromptLines = (
  task: AgentTask
): string[] => {
  const repositoryContext = getRepositoryContextFromTask(task);

  if (!repositoryContext) {
    return ["Repository context: not provided."];
  }

  const selectedFiles = repositoryContext.selectedFiles.slice(0, 4);
  const selectedPaths = selectedFiles.map((file) =>
    `${file.path}${file.truncated ? " (truncated)" : ""}`
  );
  const snippets = selectedFiles.map((file) =>
    [
      `File: ${file.path}`,
      truncate(file.content, 400)
    ].join("\n")
  );

  return [
    `Repository scope: ${repositoryContext.scope ?? "repository-wide"}`,
    `Selected files: ${selectedPaths.join(", ") || "none"}`,
    "Use only the selected files below and cite concrete paths in the answer.",
    ...snippets
  ];
};

export abstract class WorkerAgent {
  protected readonly router: ModelRouter;

  public constructor(
    protected readonly context: ExecutionContext,
    public readonly capability: WorkerCapability
  ) {
    this.router = new ModelRouter(context.workerModel);
  }

  public abstract execute(input: WorkerExecutionInput): Promise<AgentResult>;

  protected async createResult<T>({
    debugLabel,
    agentId,
    task,
    prompt,
    outputSchema,
    fallbackOutput,
    risks,
    confidence,
    artifacts = [],
    workerProfile
  }: WorkerResultOptions<T>
  ): Promise<AgentResult> {
    const primaryTaskType = this.capability.supportedTaskTypes[0] ?? "summarization";
    const routed = this.router.routeWorkerTask(
      primaryTaskType,
      workerProfile
    );
    const invocation = await invokeStructured({
      provider: routed.provider,
      config: routed.config,
      schema: outputSchema,
      prompt,
      mockResponse: fallbackOutput,
      metadata: {
        taskId: task.id,
        capability: this.capability.name
      },
      maxAttempts: 1
    });

    const finalRisks = invocation.ok
      ? risks
      : [...risks, ...invocation.errors];
    const repositoryContext = getRepositoryContextFromTask(task);
    const debugContent = {
      capability: this.capability.name,
      expectedOutputDescription: debugLabel ?? this.capability.description,
      failureKind: invocation.ok ? null : invocation.failureKind,
      prompt,
      rawOutput: invocation.ok ? invocation.data : (invocation.raw ?? invocation.rawText),
      rawText: invocation.rawText,
      repositoryContext: repositoryContext
        ? {
            requestedFiles: repositoryContext.requestedFiles,
            scope: repositoryContext.scope,
            selectedFiles: repositoryContext.selectedFiles.map((file) => file.path),
            strictFiles: repositoryContext.strictFiles,
            warnings: repositoryContext.warnings
          }
        : null,
      structuredOutputErrors: invocation.errors
    };

    return {
      taskId: task.id,
      agentId,
      role: "worker",
      status: finalRisks.length > 0 ? "needs_review" : "success",
      output: invocation.ok ? invocation.data : fallbackOutput,
      confidence,
      risks: finalRisks,
      artifacts: [
        ...artifacts,
        {
          name: "worker-debug.json",
          type: "application/json",
          content: debugContent
        }
      ],
      metadata: {
        capability: this.capability.name,
        expectedOutputDescription: debugLabel ?? this.capability.description,
        failureKind: invocation.ok ? undefined : invocation.failureKind,
        prompt,
        rawOutput: invocation.ok ? invocation.data : (invocation.raw ?? invocation.rawText),
        rawText: invocation.rawText,
        structuredOutputAttempts: invocation.attempts,
        structuredOutputErrors: invocation.errors,
        structuredOutputOk: invocation.ok,
        workerProfileStatus: workerProfile?.status
      }
    };
  }
}
