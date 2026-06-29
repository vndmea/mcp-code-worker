import { z } from "zod";

import {
  getWorkerProfile,
  requireConfiguredWorkerId
} from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  workerId: z.string().min(1)
});

export const cwGetWorkerProfileTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getWorkerProfile>>
> = {
  name: "cw_get_worker_profile",
  description: "Get a single worker capability profile by id.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    const workerId = requireConfiguredWorkerId(
      context,
      args.workerId,
      "worker profile lookup"
    );
    return getWorkerProfile(context.rootDir, workerId, context.cwStorageDir);
  }
};
