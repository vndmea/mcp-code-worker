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
  workerId: z.string().min(1),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  strictFiles: z.boolean().optional(),
  ...workflowOutputOptionShape
});

export const cwReviewRepositoryTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatReviewWorkflowOutput>
> = {
  name: "cw_review_repository",
  description: "Review repository context for a scope and return structured findings.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runReviewWorkflow({
      context,
      workerId: args.workerId,
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
