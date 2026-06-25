import { z } from "zod";

import { createExecutionContextFromEnv, listAuditEvents } from "@agent-orchestrator/core";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(100).optional()
});

export const aoListAuditEventsTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listAuditEvents>>
> = {
  name: "ao_list_audit_events",
  description: "List local audit events in reverse chronological order.",
  inputSchema,
  execute: async (args) => {
    const context = createExecutionContextFromEnv();
    return listAuditEvents(context.rootDir, args.limit ?? 50);
  }
};
