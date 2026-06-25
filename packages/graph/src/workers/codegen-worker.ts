import { z } from "zod";

import type { ExecutionContext, WorkerCapability } from "@agent-orchestrator/core";

import { WorkerAgent, type WorkerExecutionInput } from "./worker-agent.js";

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
    const fallbackOutput = {
      patchPlan: [
        "Add strict typed contracts before implementation.",
        "Keep writes gated behind policy checks.",
        "Return structured artifacts for review."
      ],
      notes: [
        input.scope ? `Limit implementation to ${input.scope}.` : "No scope provided.",
        "Candidate patches still require leader review."
      ]
    };

    return this.createResult({
      agentId: "worker.codegen",
      task: input.task,
      prompt: [
        "Return JSON with keys patchPlan and notes.",
        "Patch plans must stay dry-run and must not apply changes.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided"
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
