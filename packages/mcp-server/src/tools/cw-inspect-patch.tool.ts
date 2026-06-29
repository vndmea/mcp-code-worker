import { z } from "zod";

import { PatchProposalSchema } from "@mcp-code-worker/core";
import { inspectPatch } from "@mcp-code-worker/tools";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  patchProposal: z.unknown(),
  scope: z.string().optional()
});

export const cwInspectPatchTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof inspectPatch>>
> = {
  name: "cw_inspect_patch",
  description: "Inspect a structured patch proposal for safety and applicability.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext({
      cliOverrides: {
        dryRun: false
      }
    });
    const proposal = PatchProposalSchema.parse(args.patchProposal);

    return inspectPatch(context, proposal, {
      scope: args.scope
    });
  }
};
