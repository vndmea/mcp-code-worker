import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatTaskSessionStatusOutput,
  getTaskSessionStatus
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

export const aoGetTaskStatusTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionStatusOutput>
> = {
  name: "ao_get_task_status",
  description: "Get the current persisted state for one local task session.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const session = await getTaskSessionStatus(context.rootDir, args.taskId);
    return formatTaskSessionStatusOutput(session, resolveWorkflowOutputOptions(args));
  }
};
