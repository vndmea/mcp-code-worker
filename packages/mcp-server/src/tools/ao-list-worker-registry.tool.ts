import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { listWorkerRegistrations } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const aoListWorkerRegistryTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listWorkerRegistrations>>
> = {
  name: "ao_list_worker_registry",
  description: "List registered worker models.",
  inputSchema,
  execute: async () => {
    const context = await resolveExecutionContext();
    return listWorkerRegistrations(context.rootDir, context.aoStorageDir);
  }
};
