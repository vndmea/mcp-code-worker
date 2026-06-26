import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { listWorkerProfiles } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const aoListWorkersTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listWorkerProfiles>>
> = {
  name: "ao_list_workers",
  description: "List persisted worker capability profiles.",
  inputSchema,
  execute: async () => {
    const context = await resolveExecutionContext();
    return listWorkerProfiles(context.rootDir, context.aoStorageDir);
  }
};
