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
  answer: z.string().min(1),
  findings: z.array(z.string()).min(2),
  referencedFiles: z.array(z.string()).min(1)
});

const capability: WorkerCapability = {
  name: "review-worker",
  description: "Performs a low-cost review pass to highlight likely risks.",
  inputSchema,
  outputSchema,
  supportedTaskTypes: ["review-lite"],
  preferredModel: "worker",
  costTier: "low"
};

export class ReviewWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, capability);
  }

  public async execute(input: WorkerExecutionInput) {
    const repositoryContext = getRepositoryContextFromTask(input.task);
    const selectedPaths = repositoryContext?.selectedFiles
      .slice(0, 3)
      .map((file) => file.path) ?? [];
    const fallbackOutput = {
      answer:
        selectedPaths.length > 0
          ? `Review ${selectedPaths[0]} first for the highest-confidence implementation risk.`
          : "Review the selected repository files for the highest-confidence implementation risk.",
      findings: [
        ...(selectedPaths.length > 0
          ? [`Review concrete risks in ${selectedPaths.join(", ")}.`]
          : []),
        "Ensure dry-run behavior is preserved in CLI and MCP flows.",
        "Avoid exposing unrestricted shell access through public interfaces."
      ],
      referencedFiles: selectedPaths.length > 0 ? selectedPaths : ["repository-context"]
    };

    return this.createResult({
      debugLabel: "Direct review answer grounded in selected repository files",
      agentId: "worker.review",
      task: input.task,
      prompt: [
        "Return JSON with keys answer, findings, and referencedFiles.",
        "The answer field must directly answer the goal in one or two sentences.",
        "Focus on implementation and workflow risks.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.77,
      artifacts: [],
      workerProfile: input.workerProfile
    });
  }
}
