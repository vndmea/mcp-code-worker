import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { resumeTaskSessionWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  taskId: z.string().min(1),
  fromStep: z.string().optional(),
  proposePatch: z.boolean().optional(),
  inspectPatch: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  confirmApply: z.boolean().optional(),
  allowWriteSession: z.boolean().optional()
});

export const aoResumeTaskTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof resumeTaskSessionWorkflow>>
> = {
  name: "ao_resume_task",
  description: "Resume a stored local task session, skipping successful steps unless told otherwise.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext({
      cliOverrides: {
        allowWrite: args.allowWrite,
        dryRun: !args.allowWrite
      }
    });

    return resumeTaskSessionWorkflow({
      context,
      taskId: args.taskId,
      fromStep: args.fromStep,
      proposePatch: args.proposePatch,
      inspectPatch: args.inspectPatch,
      applyPatch: args.applyPatch,
      allowWrite: args.allowWrite,
      confirmApply: args.confirmApply,
      allowWriteSession: args.allowWriteSession
    });
  }
};
