import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { runRepositoryValidation } from "@agent-orchestrator/tools";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  execute: z.boolean().optional()
});

export const aoValidateRepositoryTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runRepositoryValidation>>
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

    return runRepositoryValidation(context, {
      typecheck: args.typecheck,
      lint: args.lint,
      test: args.test
    });
  }
};
