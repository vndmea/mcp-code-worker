import { z } from "zod";

import { resolveExecutionContext } from "@mcp-code-worker/core";
import {
  formatReviewWorkflowOutput,
  runReviewWorkflow
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  base: z.string().optional(),
  head: z.string().optional(),
  workerId: z.string().min(1),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  strictFiles: z.boolean().optional(),
  ...workflowOutputOptionShape
});

export const cwReviewDiffTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatReviewWorkflowOutput>
> = {
  name: "cw_review_diff",
  description: "Review a git diff and return structured impact analysis.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runReviewWorkflow({
      context,
      workerId: args.workerId,
      includeDiff: true,
      diffBase: args.base,
      diffHead: args.head,
      scope: args.scope,
      strictFiles: args.strictFiles,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    });

    return formatReviewWorkflowOutput(result, resolveWorkflowOutputOptions(args));
  }
};
