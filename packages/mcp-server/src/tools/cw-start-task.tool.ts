import { z } from "zod";

import { resolveExecutionContext } from "@mcp-code-worker/core";
import {
  formatTaskSessionWorkflowOutput,
  runTaskSessionWorkflow
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  scope: z.string().optional(),
  workerId: z.string().min(1),
  requireProfile: z.boolean().optional(),
  errorLog: z.string().optional(),
  errorLogFile: z.string().optional(),
  runFix: z.boolean().optional(),
  typecheck: z.boolean().optional(),
  lint: z.boolean().optional(),
  test: z.boolean().optional(),
  proposePatch: z.boolean().optional(),
  inspectPatch: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  allowDirtyWorktree: z.boolean().optional(),
  confirmApply: z.boolean().optional(),
  allowWriteSession: z.boolean().optional(),
  ...workflowOutputOptionShape
});

export const cwStartTaskTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionWorkflowOutput>
> = {
  name: "cw_start_task",
  description: "Recommended host-facing coding entrypoint. Keep the host in control while cw manages repository context, validation, task artifacts, and patch gates.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext({
      cliOverrides: {
        ...(args.allowWrite
          ? {
              allowWrite: true,
              dryRun: false
            }
          : {})
      }
    });

    const result = await runTaskSessionWorkflow({
      context,
      errorLog: args.errorLog,
      errorLogFile: args.errorLogFile,
      goal: args.goal,
      scope: args.scope,
      workerId: args.workerId,
      requireProfile: args.requireProfile,
      runFix: args.runFix,
      validate: {
        typecheck: args.typecheck,
        lint: args.lint,
        test: args.test
      },
      proposePatch: args.proposePatch,
      inspectPatch: args.inspectPatch,
      applyPatch: args.applyPatch,
      allowWrite: args.allowWrite,
      allowDirtyWorktree: args.allowDirtyWorktree,
      confirmApply: args.confirmApply,
      allowWriteSession: args.allowWriteSession
    });

    return formatTaskSessionWorkflowOutput(result, resolveWorkflowOutputOptions(args));
  }
};
