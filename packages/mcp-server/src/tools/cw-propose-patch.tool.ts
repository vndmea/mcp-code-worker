import { z } from "zod";

import {
  formatPatchProposalWorkflowOutput,
  runPatchProposalWorkflow
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  goal: z.string().optional(),
  scope: z.string().optional(),
  errorLog: z.string().optional(),
  workerId: z.string().min(1),
  requireProfile: z.boolean().optional(),
  detailLevel: workflowOutputOptionShape.detailLevel,
  maxBytes: workflowOutputOptionShape.maxBytes
});

export const cwProposePatchTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runPatchProposalWorkflow>> | Record<string, unknown>
> = {
  name: "cw_propose_patch",
  description: "Generate a structured patch proposal and inspect it without applying changes.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    const result = await runPatchProposalWorkflow({
      context,
      goal: args.goal,
      scope: args.scope,
      errorLog: args.errorLog,
      workerId: args.workerId,
      requireProfile: args.requireProfile
    });

    return formatPatchProposalWorkflowOutput(
      result,
      resolveWorkflowOutputOptions(args)
    );
  }
};
