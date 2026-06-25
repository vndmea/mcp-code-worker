import { z } from "zod";

import { runReviewWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  maxFileBytes: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

export const aoReviewRepositoryTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runReviewWorkflow>>
> = {
  name: "ao_review_repository",
  description: "Review repository context for a scope and return structured findings.",
  inputSchema,
  execute: async (args) =>
    runReviewWorkflow({
      scope: args.scope,
      maxFileBytes: args.maxFileBytes,
      maxTotalBytes: args.maxTotalBytes,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    })
};
