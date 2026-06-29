import { z } from "zod";

import { getWorkerRegistration } from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  workerId: z.string().min(1)
});

export const cwGetWorkerRegistrationTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof getWorkerRegistration>>
> = {
  name: "cw_get_worker_registration",
  description: "Get one registered worker model.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    return getWorkerRegistration(
      context.rootDir,
      args.workerId,
      context.cwStorageDir
    );
  }
};
