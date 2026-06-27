import { z } from "zod";

import type { ExecutionContext, WorkerCapability } from "@agent-orchestrator/core";

import {
  buildRepositoryContextPromptLines,
  getRepositoryContextFromTask,
  WorkerAgent,
  type WorkerExecutionInput
} from "./worker-agent.js";

const inputSchema = z.object({
  goal: z.string()
});

const outputSchema = z.object({
  suggestedTests: z.array(z.string())
});

const capability: WorkerCapability = {
  name: "test-worker",
  description: "Suggests workflow and policy coverage to validate changes.",
  inputSchema,
  outputSchema,
  supportedTaskTypes: ["test-generation"],
  preferredModel: "worker",
  costTier: "low"
};

export class TestWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, capability);
  }

  public async execute(input: WorkerExecutionInput) {
    const repositoryContext = getRepositoryContextFromTask(input.task);
    const selectedPaths = repositoryContext?.selectedFiles
      .map((file) => file.path) ?? [];
    const fallbackOutput = {
      suggestedTests: [
        ...(selectedPaths.length > 0
          ? [`Add focused coverage around ${selectedPaths.join(" and ")}.`]
          : []),
        "Validate schema parsing for structured workflow outputs.",
        "Validate state transitions for host-managed review and task-session workflows.",
        "Validate write and shell safety policies."
      ]
    };

    return this.createResult({
      debugLabel: "Deterministic test suggestions grounded in selected repository files",
      agentId: "worker.test",
      task: input.task,
      prompt: [
        "Return JSON with key suggestedTests.",
        "Focus on deterministic validation ideas only.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.81,
      artifacts: [],
      allowUnqualifiedExecution: input.allowUnqualifiedExecution,
      workerProfile: input.workerProfile
    });
  }
}
