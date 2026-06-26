import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatTaskSessionReportOutput,
  getTaskSessionReport
} from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  taskId: z.string().min(1),
  ...workflowOutputOptionShape
});

export const aoGetTaskReportTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionReportOutput>
> = {
  name: "ao_get_task_report",
  description: "Render a readable markdown report for one local task session.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const report = await getTaskSessionReport(
      context.rootDir,
      args.taskId,
      context.aoStorageDir
    );
    return formatTaskSessionReportOutput(report, resolveWorkflowOutputOptions(args));
  }
};
