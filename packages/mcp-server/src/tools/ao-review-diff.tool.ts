import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatReviewWorkflowOutput,
  runReviewWorkflow
} from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  base: z.string().optional(),
  head: z.string().optional(),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  maxFileBytes: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional(),
  ...workflowOutputOptionShape
});

export const aoReviewDiffTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatReviewWorkflowOutput>
> = {
  name: "ao_review_diff",
  description: "Review a git diff and return structured impact analysis.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runReviewWorkflow({
      context,
      includeDiff: true,
      diffBase: args.base,
      diffHead: args.head,
      scope: args.scope,
      maxFileBytes: args.maxFileBytes,
      maxTotalBytes: args.maxTotalBytes,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    });

    return formatReviewWorkflowOutput(result, resolveWorkflowOutputOptions(args));
  }
};
