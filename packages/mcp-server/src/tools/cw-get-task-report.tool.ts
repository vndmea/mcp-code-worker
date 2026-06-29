import { z } from "zod";

import {
  formatTaskSessionReportOutput,
  getTaskSessionReport
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  taskId: z.string().min(1),
  ...workflowOutputOptionShape
});

export const cwGetTaskReportTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionReportOutput>
> = {
  name: "cw_get_task_report",
  description: "Render a readable markdown report for one local task session.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    const report = await getTaskSessionReport(
      context.rootDir,
      args.taskId,
      context.cwStorageDir
    );
    return formatTaskSessionReportOutput(report, resolveWorkflowOutputOptions(args));
  }
};
