import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatTaskSessionListOutput,
  listStoredTaskSessions
} from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  ...workflowOutputOptionShape
});

export const aoListTasksTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionListOutput>
> = {
  name: "ao_list_tasks",
  description: "List stored local task sessions in reverse chronological order.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const sessions = await listStoredTaskSessions(context.rootDir, args.limit ?? 50);
    return formatTaskSessionListOutput(sessions, resolveWorkflowOutputOptions(args));
  }
};
