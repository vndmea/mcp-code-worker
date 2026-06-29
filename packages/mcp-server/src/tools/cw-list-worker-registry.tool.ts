import { z } from "zod";

import { listWorkerRegistrations } from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({});

export const cwListWorkerRegistryTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listWorkerRegistrations>>
> = {
  name: "cw_list_worker_registry",
  description: "List registered worker models.",
  inputSchema,
  execute: async () => {
    const context = await resolveToolContext();
    return listWorkerRegistrations(context.rootDir, context.cwStorageDir);
  }
};
