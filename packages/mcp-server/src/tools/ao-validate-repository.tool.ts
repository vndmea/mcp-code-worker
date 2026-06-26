import { z } from "zod";

import {
  resolveExecutionContext,
  summarizeValidationReport
} from "@agent-orchestrator/core";
import { runRepositoryValidation } from "@agent-orchestrator/tools";

import type { AoToolDefinition } from "./tool-types.js";
import { workflowOutputOptionShape } from "./output-options.js";

const inputSchema = z.object({
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  execute: z.boolean().optional(),
  detailLevel: workflowOutputOptionShape.detailLevel,
  maxBytes: workflowOutputOptionShape.maxBytes
});

export const aoValidateRepositoryTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runRepositoryValidation>> | ReturnType<typeof summarizeValidationReport>
> = {
  name: "ao_validate_repository",
  description: "Run deterministic repository validation checks with dry-run by default.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext({
      cliOverrides: {
        ...(args.execute ? { dryRun: false } : {})
      }
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
