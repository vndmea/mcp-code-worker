import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatTaskSessionWorkflowOutput,
  runTaskSessionWorkflow
} from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  scope: z.string().optional(),
  workerId: z.string().optional(),
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

export const aoStartTaskTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionWorkflowOutput>
> = {
  name: "ao_start_task",
  description: "Recommended high-level coding task entrypoint. Start a local task session, persist reviewable artifacts in user-scoped ao storage when allowed, and return next recommended actions.",
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
