import { z } from "zod";

import {
  formatTaskSessionWorkflowOutput,
  resumeTaskSessionWorkflow
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";
import {
  createAllowWriteCliOverrides,
  resolveToolContext
} from "./tool-runtime.js";

const inputSchema = z.object({
  taskId: z.string().min(1),
  fromStep: z.string().optional(),
  errorLog: z.string().optional(),
  errorLogFile: z.string().optional(),
  runFix: z.boolean().optional(),
  proposePatch: z.boolean().optional(),
  inspectPatch: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  allowWrite: z.boolean().optional(),
  allowDirtyWorktree: z.boolean().optional(),
  confirmApply: z.boolean().optional(),
  allowWriteSession: z.boolean().optional(),
  ...workflowOutputOptionShape
});

export const cwResumeTaskTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionWorkflowOutput>
> = {
  name: "cw_resume_task",
  description: "Resume a stored local task session, skip successful steps unless told otherwise, and return updated next recommended actions.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext({
      cliOverrides: createAllowWriteCliOverrides(args.allowWrite)
    });

    const result = await resumeTaskSessionWorkflow({
      context,
      taskId: args.taskId,
      errorLog: args.errorLog,
      errorLogFile: args.errorLogFile,
      fromStep: args.fromStep,
      proposePatch: args.proposePatch,
      inspectPatch: args.inspectPatch,
      runFix: args.runFix,
      applyPatch: args.applyPatch,
      allowWrite: args.allowWrite,
      allowDirtyWorktree: args.allowDirtyWorktree,
      confirmApply: args.confirmApply,
      allowWriteSession: args.allowWriteSession
    });

    return formatTaskSessionWorkflowOutput(result, resolveWorkflowOutputOptions(args));
  }
};
