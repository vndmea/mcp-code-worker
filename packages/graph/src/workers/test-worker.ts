import { z } from "zod";

import type { ExecutionContext, WorkerCapability } from "@agent-orchestrator/core";

import { WorkerAgent, type WorkerExecutionInput } from "./worker-agent.js";

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
    const fallbackOutput = {
      suggestedTests: [
        "Validate schema parsing for structured workflow outputs.",
        "Validate state transitions for planning and leader-worker workflows.",
        "Validate write and shell safety policies."
      ]
    };

    return this.createResult({
      agentId: "worker.test",
      task: input.task,
      prompt: [
        "Return JSON with key suggestedTests.",
        "Focus on deterministic validation ideas only.",
        `Goal: ${input.task.goal}`
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.81,
      artifacts: [],
      workerProfile: input.workerProfile
    });
  }
}
