import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { getWorkerRegistration } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().min(1)
});

export const aoGetWorkerRegistrationTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getWorkerRegistration>>
> = {
  name: "ao_get_worker_registration",
  description: "Get one registered worker model.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    return getWorkerRegistration(
      context.rootDir,
      args.workerId,
      context.aoStorageDir
    );
  }
};
