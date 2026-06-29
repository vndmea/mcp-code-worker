import { z } from "zod";

import {
  getWorkerRegistration,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import {
  createAllowWriteCliOverrides,
  resolveToolContext
} from "./tool-runtime.js";
import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  allowWrite: z.boolean().optional()
});

export const cwRegisterWorkerTool: CwToolDefinition<
  typeof inputSchema.shape,
  { mode: "execute" | "dry-run"; path: string; workerId: string }
> = {
  name: "cw_register_worker",
  description: "Register a worker model in the local worker registry.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext({
      cliOverrides: createAllowWriteCliOverrides(args.allowWrite ?? false)
    });
    const workerId = args.workerId;
    const existing = await getWorkerRegistration(
      context.rootDir,
      workerId,
      context.cwStorageDir
    );
    const now = new Date().toISOString();
    const result = await saveWorkerRegistration(
      context,
      {
        workerId,
        provider: args.provider,
        model: args.model,
        baseURL: args.baseURL,
        enabled: existing?.enabled ?? true,
        tags: args.tags ?? [],
        notes: args.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      },
      args.allowWrite ?? false
    );

    return {
      ...result,
      workerId
    };
  }
};
