import { z } from "zod";

import {
  formatTaskSessionListOutput,
  listStoredTaskSessions
} from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";
import {
  resolveWorkflowOutputOptions,
  workflowOutputOptionShape
} from "./output-options.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  ...workflowOutputOptionShape
});

export const cwListTasksTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<typeof formatTaskSessionListOutput>
> = {
  name: "cw_list_tasks",
  description: "List stored local task sessions in reverse chronological order.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    const sessions = await listStoredTaskSessions(
      context.rootDir,
      args.limit ?? 50,
      context.cwStorageDir
    );
    return formatTaskSessionListOutput(sessions, resolveWorkflowOutputOptions(args));
  }
};
