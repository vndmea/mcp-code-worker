import { z } from "zod";

import type { ExecutionContext, WorkerCapability } from "@agent-orchestrator/core";

import {
  buildRepositoryContextPromptLines,
  getRepositoryContextFromTask,
  WorkerAgent,
  type WorkerExecutionInput
} from "./worker-agent.js";

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
  supportedTaskTypes: [
    "summarization",
    "log-analysis",
    "json-extraction",
    "doc-generation"
  ],
  preferredModel: "worker",
  costTier: "low"
};

export class SummarizeWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, capability);
  }

  public async execute(input: WorkerExecutionInput) {
    const repositoryContext = getRepositoryContextFromTask(input.task);
    const selectedPaths = repositoryContext?.selectedFiles
      .map((file) => file.path) ?? [];
    const fallbackOutput = {
      brief:
        selectedPaths.length > 0
          ? `Summarized ${input.task.goal} using ${selectedPaths.join(", ")}.`
          : `Summarized goal: ${input.task.goal}`,
      focusAreas: [
        ...(selectedPaths.length > 0
          ? [`Stay grounded in ${selectedPaths.join(", ")}.`]
          : []),
        input.scope ? `Scope work to ${input.scope}` : "Scope not provided; keep changes minimal.",
        "Preserve package boundaries.",
        "Prefer deterministic validation."
      ]
    };

    return this.createResult({
      debugLabel: "Compact repository-grounded summary",
      agentId: "worker.summarize",
      task: input.task,
      prompt: [
        "Return JSON with keys brief and focusAreas.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided",
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.86,
      artifacts: [],
      allowUnqualifiedExecution: input.allowUnqualifiedExecution,
      workerProfile: input.workerProfile
    });
  }
}
