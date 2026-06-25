import type {
  AgentResult,
  AgentTask,
  ExecutionContext,
  WorkerCapability,
  WorkerCapabilityProfile
} from "@agent-orchestrator/core";
import { ModelRouter, invokeStructured } from "@agent-orchestrator/models";
import type { ZodType } from "zod";

export interface WorkerExecutionInput {
  notes?: string[];
  scope?: string;
  task: AgentTask;
  workerProfile?: WorkerCapabilityProfile | null;
}

export interface WorkerResultOptions<T> {
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

export abstract class WorkerAgent {
  protected readonly router: ModelRouter;

  public constructor(
    protected readonly context: ExecutionContext,
    public readonly capability: WorkerCapability
  ) {
    this.router = new ModelRouter(context.leaderModel, context.workerModel);
  }

  public abstract execute(input: WorkerExecutionInput): Promise<AgentResult>;

  protected async createResult<T>({
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

    return {
      taskId: task.id,
      agentId,
      role: "worker",
      status: finalRisks.length > 0 ? "needs_review" : "success",
      output: invocation.ok ? invocation.data : fallbackOutput,
      confidence,
      risks: finalRisks,
      artifacts,
      metadata: {
        capability: this.capability.name,
        structuredOutputAttempts: invocation.attempts,
        structuredOutputOk: invocation.ok,
        workerProfileStatus: workerProfile?.status
      }
    };
  }
}
