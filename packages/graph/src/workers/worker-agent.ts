import type {
  AgentResult,
  AgentTask,
  ExecutionContext,
  PlannedWorkerTask,
  RepositoryContextPack,
  WorkerCapability,
  WorkerCapabilityProfile
} from "@mcp-code-worker/core";
import { ModelRouter, invokeStructured } from "@mcp-code-worker/models";
import type { ZodType } from "zod";

export interface WorkerExecutionInput {
  allowUnqualifiedExecution?: boolean;
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
  mockResponse?: unknown;
  risks: string[];
  confidence: number;
  artifacts?: AgentResult["artifacts"];
  allowUnqualifiedExecution?: boolean;
  maxStructuredAttempts?: number;
  workerProfile?: WorkerCapabilityProfile | null;
}

interface TaskInputWithRepositoryContext {
  errorLog?: string;
  errorLogFile?: string;
  repositoryContext?: RepositoryContextPack;
}

const asTaskInputWithRepositoryContext = (
  value: unknown
): TaskInputWithRepositoryContext =>
  value && typeof value === "object"
    ? value
    : {};

export const getRepositoryContextFromTask = (
  task: AgentTask
): RepositoryContextPack | null =>
  asTaskInputWithRepositoryContext(task.input).repositoryContext ?? null;

export const getErrorLogFromTask = (task: AgentTask): string | null => {
  const value = asTaskInputWithRepositoryContext(task.input).errorLog;

  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export const buildRepositoryContextPromptLines = (
  task: AgentTask
): string[] => {
  const repositoryContext = getRepositoryContextFromTask(task);

  if (!repositoryContext) {
    return ["Repository context: not provided."];
  }

  const selectedFiles = repositoryContext.selectedFiles;
  const selectedPaths = selectedFiles.map((file) =>
    `${file.path}${file.truncated ? " (truncated)" : ""}`
  );
  const snippets = selectedFiles.map((file) =>
    [
      `File: ${file.path}`,
      file.content
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
    mockResponse,
    risks,
    confidence,
    artifacts = [],
    allowUnqualifiedExecution,
    maxStructuredAttempts,
    workerProfile
  }: WorkerResultOptions<T>
  ): Promise<AgentResult> {
    const primaryTaskType = this.capability.supportedTaskTypes[0] ?? "summarization";
    const routed = this.router.routeWorkerTask(
      primaryTaskType,
      allowUnqualifiedExecution ? null : workerProfile
    );
    const invocation = await invokeStructured({
      provider: routed.provider,
      config: routed.config,
      schema: outputSchema,
      prompt,
      mockResponse: mockResponse ?? fallbackOutput,
      metadata: {
        taskId: task.id,
        capability: this.capability.name
      },
      maxAttempts:
        maxStructuredAttempts ??
        routed.behaviorProfile.structuredOutput.repairAttempts
    });

    const finalRisks = invocation.ok
      ? risks
      : [...risks, ...invocation.errors];
    const repositoryContext = getRepositoryContextFromTask(task);
    const debugContent = {
      capability: this.capability.name,
      expectedOutputDescription: debugLabel ?? this.capability.description,
      failureKind: invocation.ok ? null : invocation.failureKind,
      modelBehaviorProfile: routed.behaviorProfile.id,
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
      structuredOutputFallbackReason: invocation.structuredOutputFallbackReason,
      structuredOutputErrors: invocation.errors,
      structuredOutputMode: invocation.structuredOutputMode
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
        modelBehaviorProfile: routed.behaviorProfile.id,
        modelBehaviorStructuredOutputPreferredMode:
          routed.behaviorProfile.structuredOutput.preferredMode,
        prompt,
        rawOutput: invocation.ok ? invocation.data : (invocation.raw ?? invocation.rawText),
        rawText: invocation.rawText,
        structuredOutputFallbackReason: invocation.structuredOutputFallbackReason,
        structuredOutputAttempts: invocation.attempts,
        structuredOutputErrors: invocation.errors,
        structuredOutputMode: invocation.structuredOutputMode,
        structuredOutputOk: invocation.ok,
        workerProfileStatus: workerProfile?.status
      }
    };
  }
}
