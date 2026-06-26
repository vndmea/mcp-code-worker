import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatFixErrorWorkflowOutput,
  runFixErrorWorkflow
} from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  errorLog: z.string().optional(),
  errorLogFile: z.string().optional(),
  proposePatch: z.boolean().optional(),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  ...workflowOutputOptionShape
});

export const aoFixErrorTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatFixErrorWorkflowOutput>
> = {
  name: "ao_fix_error",
  description: "Analyze an error log, propose a safe fix plan, and return validation guidance.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runFixErrorWorkflow({
      context,
      errorLog: args.errorLog,
      errorLogFile: args.errorLogFile,
      proposePatch: args.proposePatch,
      scope: args.scope,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    });

    return formatFixErrorWorkflowOutput(result, resolveWorkflowOutputOptions(args));
  }
};
