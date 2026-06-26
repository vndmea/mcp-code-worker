import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  ModelRouter,
  getWorkerProfile
} from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().optional()
});

export const aoGetWorkerProfileTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getWorkerProfile>>
> = {
  name: "ao_get_worker_profile",
  description: "Get a single worker capability profile by id.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const workerId =
      args.workerId ?? ModelRouter.deriveWorkerId(context.workerModel);
    return getWorkerProfile(context.rootDir, workerId, context.aoStorageDir);
  }
};
