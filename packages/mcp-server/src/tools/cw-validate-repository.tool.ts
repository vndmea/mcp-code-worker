import { z } from "zod";

import {
  summarizeValidationReport
} from "@mcp-code-worker/core";
import { runRepositoryValidation } from "@mcp-code-worker/tools";

import type { CwToolDefinition } from "./tool-types.js";
import { workflowOutputOptionShape } from "./output-options.js";
import {
  createExecuteCliOverrides,
  resolveToolContext
} from "./tool-runtime.js";

const inputSchema = z.object({
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  execute: z.boolean().optional(),
  detailLevel: workflowOutputOptionShape.detailLevel,
  maxBytes: workflowOutputOptionShape.maxBytes
});

export const cwValidateRepositoryTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runRepositoryValidation>> | ReturnType<typeof summarizeValidationReport>
> = {
  name: "cw_validate_repository",
  description: "Run deterministic repository validation checks with dry-run by default.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext({
      cliOverrides: createExecuteCliOverrides(args.execute)
    });

    const result = await runRepositoryValidation(context, {
      typecheck: args.typecheck,
      lint: args.lint,
      test: args.test
    });

    return args.detailLevel === "full"
      ? result
      : summarizeValidationReport(result, args.maxBytes);
  }
};
