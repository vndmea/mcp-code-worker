import { z } from "zod";

import { runFixErrorWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  errorLog: z.string().optional(),
  errorLogFile: z.string().optional(),
  scope: z.string().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional()
});

export const aoFixErrorTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runFixErrorWorkflow>>
> = {
  name: "ao_fix_error",
  description: "Analyze an error log, propose a safe fix plan, and return validation guidance.",
  inputSchema,
  execute: async (args) =>
    runFixErrorWorkflow({
      errorLog: args.errorLog,
      errorLogFile: args.errorLogFile,
      scope: args.scope,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      }
    })
};
