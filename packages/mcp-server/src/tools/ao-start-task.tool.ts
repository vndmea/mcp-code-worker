import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { runTaskSessionWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  scope: z.string().optional(),
  workerId: z.string().optional(),
  requireProfile: z.boolean().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  proposePatch: z.boolean().optional(),
  inspectPatch: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  confirmApply: z.boolean().optional(),
  allowWriteSession: z.boolean().optional()
});

export const aoStartTaskTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runTaskSessionWorkflow>>
> = {
  name: "ao_start_task",
  description: "Start a local task session and persist reviewable artifacts under .ao/runs when allowed.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext({
      cliOverrides: {
        allowWrite: args.allowWrite,
        dryRun: !args.allowWrite
      }
    });

    return runTaskSessionWorkflow({
      context,
      goal: args.goal,
      scope: args.scope,
      workerId: args.workerId,
      requireProfile: args.requireProfile,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      },
      proposePatch: args.proposePatch,
      inspectPatch: args.inspectPatch,
      applyPatch: args.applyPatch,
      allowWrite: args.allowWrite,
      confirmApply: args.confirmApply,
      allowWriteSession: args.allowWriteSession
    });
  }
};
