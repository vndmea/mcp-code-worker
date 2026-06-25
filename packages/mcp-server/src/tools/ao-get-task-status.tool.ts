import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { getTaskSessionStatus } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  taskId: z.string().min(1)
});

export const aoGetTaskStatusTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getTaskSessionStatus>>
> = {
  name: "ao_get_task_status",
  description: "Get the current persisted state for one local task session.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    return getTaskSessionStatus(context.rootDir, args.taskId);
  }
};
