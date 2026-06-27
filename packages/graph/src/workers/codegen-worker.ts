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
  patchPlan: z.array(z.string()),
  notes: z.array(z.string())
});

const capability: WorkerCapability = {
  name: "codegen-worker",
  description: "Produces candidate implementation notes or patch plans.",
  inputSchema,
  outputSchema,
  supportedTaskTypes: ["codegen"],
  preferredModel: "worker",
  costTier: "medium"
};

export class CodegenWorker extends WorkerAgent {
  public constructor(context: ExecutionContext) {
    super(context, capability);
  }

  public async execute(input: WorkerExecutionInput) {
    const repositoryContext = getRepositoryContextFromTask(input.task);
    const selectedPaths = repositoryContext?.selectedFiles
      .slice(0, 3)
      .map((file) => file.path) ?? [];
    const fallbackOutput = {
      patchPlan: [
        ...(selectedPaths.length > 0
          ? [`Start from ${selectedPaths[0]}.`]
          : []),
        "Add strict typed contracts before implementation.",
        "Keep writes gated behind policy checks.",
        "Return structured artifacts for review."
      ],
      notes: [
        ...(selectedPaths.length > 0
          ? [`Ground the plan in ${selectedPaths.join(", ")}.`]
          : []),
        input.scope ? `Limit implementation to ${input.scope}.` : "No scope provided.",
        "Candidate patches still require host review."
      ]
    };

    return this.createResult({
      debugLabel: "Structured patch-plan notes grounded in selected repository files",
      agentId: "worker.codegen",
      task: input.task,
      prompt: [
        "Return JSON with keys patchPlan and notes.",
        "Patch plans must stay dry-run and must not apply changes.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided",
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n"),
      outputSchema,
      fallbackOutput,
      risks: ["Generated code suggestions should not be accepted without deterministic validation."],
      confidence: 0.72,
      artifacts: [
        {
          name: "candidate-patch-plan.md",
          type: "text/markdown",
          content: "- Add contracts\n- Wire workflows\n- Validate before acceptance\n"
        }
      ],
      workerProfile: input.workerProfile
    });
  }
}
