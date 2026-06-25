import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { listStoredTaskSessions } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(100).optional()
});

export const aoListTasksTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listStoredTaskSessions>>
> = {
  name: "ao_list_tasks",
  description: "List stored local task sessions in reverse chronological order.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    return listStoredTaskSessions(context.rootDir, args.limit ?? 50);
  }
};
