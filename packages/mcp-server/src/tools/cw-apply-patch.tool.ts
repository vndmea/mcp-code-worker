import { z } from "zod";

import { PatchProposalSchema } from "@mcp-code-worker/core";
import { applyPatchProposal } from "@mcp-code-worker/tools";

import {
  createAllowWriteCliOverrides,
  createExecuteCliOverrides,
  resolveToolContext
} from "./tool-runtime.js";
import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  patchProposal: z.unknown(),
  dryRun: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  allowDirtyWorktree: z.boolean().optional(),
  confirmApply: z.boolean().optional(),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional()
});

export const cwApplyPatchTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof applyPatchProposal>>
> = {
  name: "cw_apply_patch",
  description: "Apply a structured patch proposal with dry-run default and explicit confirmation gates.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext({
      cliOverrides: {
        ...createAllowWriteCliOverrides(args.allowWrite, {
          dryRunWhenDisallowed: false
        }),
        ...createExecuteCliOverrides(true)
      }
    });
    const proposal = PatchProposalSchema.parse(args.patchProposal);

    return applyPatchProposal(context, proposal, {
      dryRun: args.dryRun ?? !args.allowWrite,
      allowWrite: args.allowWrite,
      allowDirtyWorktree: args.allowDirtyWorktree,
      confirmApply: args.confirmApply,
      scope: args.scope,
      runValidation: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    });
  }
};
