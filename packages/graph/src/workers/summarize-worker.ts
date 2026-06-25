import { z } from "zod";

import type { ExecutionContext, WorkerCapability } from "@agent-orchestrator/core";

import { WorkerAgent, type WorkerExecutionInput } from "./worker-agent.js";

const inputSchema = z.object({
  goal: z.string(),
  scope: z.string().optional()
});

const outputSchema = z.object({
  brief: z.string(),
  focusAreas: z.array(z.string())
});

const capability: WorkerCapability = {
  name: "summarize-worker",
  description: "Summarizes goals and scoped context into a compact execution brief.",
  inputSchema,
  outputSchema,
  supportedTaskTypes: ["summarization", "log-analysis", "json-extraction"],
  preferredModel: "worker",
  costTier: "low"
};

export class SummarizeWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, capability);
  }

  public async execute(input: WorkerExecutionInput) {
    const fallbackOutput = {
      brief: `Summarized goal: ${input.task.goal}`,
      focusAreas: [
        input.scope ? `Scope work to ${input.scope}` : "Scope not provided; keep changes minimal.",
        "Preserve package boundaries.",
        "Prefer deterministic validation."
      ]
    };

    return this.createResult({
      agentId: "worker.summarize",
      task: input.task,
      prompt: [
        "Return JSON with keys brief and focusAreas.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided"
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.86,
      artifacts: [],
      workerProfile: input.workerProfile
    });
  }
}
