import { z } from "zod";

import { listWorkerProfiles } from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({});

export const cwListWorkersTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listWorkerProfiles>>
> = {
  name: "cw_list_workers",
  description: "List persisted worker capability profiles.",
  inputSchema,
  execute: async () => {
    const context = await resolveToolContext();
    return listWorkerProfiles(context.rootDir, context.cwStorageDir);
  }
};
