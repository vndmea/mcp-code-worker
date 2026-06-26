import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  deriveWorkerRegistrationId,
  getWorkerRegistration,
  saveWorkerRegistration
} from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  apiKeyEnvVar: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  allowWrite: z.boolean().optional()
});

export const aoRegisterWorkerTool: AoToolDefinition<
  typeof inputSchema.shape,
  { mode: "execute" | "dry-run"; path: string; workerId: string }
> = {
  name: "ao_register_worker",
  description: "Register a worker model in the local worker registry.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext({
      cliOverrides: {
        allowWrite: args.allowWrite ?? false,
        dryRun: !(args.allowWrite ?? false)
      }
    });
    const workerId =
      args.workerId ??
      deriveWorkerRegistrationId({
        provider: args.provider,
        model: args.model
      });
    const existing = await getWorkerRegistration(
      context.rootDir,
      workerId,
      context.aoStorageDir
    );
    const now = new Date().toISOString();
    const result = await saveWorkerRegistration(
      context,
      {
        workerId,
        provider: args.provider,
        model: args.model,
        baseURL: args.baseURL,
        apiKeyEnvVar: args.apiKeyEnvVar,
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
