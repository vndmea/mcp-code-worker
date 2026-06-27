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
  findings: z.array(z.string().min(1)),
  referencedFiles: z.array(z.string().min(1))
}).strict();

const capability: WorkerCapability = {
  name: "review-worker",
  description: "Performs a low-cost review pass to highlight likely risks.",
  inputSchema,
  outputSchema,
  supportedTaskTypes: ["review-lite", "risk-analysis", "code-understanding"],
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
      .map((file) => file.path) ?? [];
    const citedPathsLine =
      selectedPaths.length > 0
        ? `Allowed referencedFiles values: ${selectedPaths.join(", ")}.`
        : "Allowed referencedFiles values: only paths from the selected repository context.";
    const fallbackOutput = {
      answer:
        selectedPaths.length > 0
          ? `The current change looks partial until ${selectedPaths[0]} is verified end to end against the selected repository paths.`
          : "The current change is partial until the selected repository files are verified end to end.",
      findings: [
        ...(selectedPaths.length > 0
          ? [
              `${selectedPaths[0]} should be checked first for the highest-confidence workflow risk.`,
              `${selectedPaths[selectedPaths.length - 1]} should preserve dry-run behavior in CLI and MCP flows.`
            ]
          : [
              "repository-context should be checked first for the highest-confidence workflow risk.",
              "repository-context should preserve dry-run behavior in CLI and MCP flows."
            ]),
        ...(selectedPaths.length > 0
          ? [
              `${selectedPaths.join(", ")} must not expose unrestricted shell access through public interfaces.`
            ]
          : []),
        selectedPaths.length === 0
          ? "repository-context must not expose unrestricted shell access through public interfaces."
          : `${selectedPaths[0]} must keep review output grounded in the selected repository paths.`
      ],
      referencedFiles: selectedPaths.length > 0 ? selectedPaths : ["repository-context"]
    };

    return this.createResult({
      debugLabel: "Direct review answer grounded in selected repository files",
      agentId: "worker.review",
      task: input.task,
      prompt: [
        "Return valid JSON only. Do not include markdown fences or explanatory prose.",
        'Return exactly one JSON object with keys "answer", "findings", and "referencedFiles".',
        "Do not include extra keys.",
        "The answer field must directly answer the goal and should state complete, partial, or incorrect when applicable.",
        "The findings field must be a JSON array of strings.",
        "The referencedFiles field must be a JSON array of strings.",
        "Focus on implementation and workflow risks.",
        "Every finding must mention at least one concrete selected repository file path.",
        "Reference concrete repository file paths from the provided context only.",
        citedPathsLine,
        `Goal: ${input.task.goal}`,
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: [],
      confidence: 0.77,
      artifacts: [],
      allowUnqualifiedExecution: input.allowUnqualifiedExecution,
      maxStructuredAttempts: 2,
      workerProfile: input.workerProfile
    });
  }
}
