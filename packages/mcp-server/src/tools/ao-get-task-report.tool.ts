import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { getTaskSessionReport } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  taskId: z.string().min(1)
});

export const aoGetTaskReportTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getTaskSessionReport>>
> = {
  name: "ao_get_task_report",
  description: "Render a readable markdown report for one local task session.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    return getTaskSessionReport(context.rootDir, args.taskId);
  }
};
