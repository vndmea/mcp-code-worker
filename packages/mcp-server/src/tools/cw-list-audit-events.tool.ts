import { z } from "zod";

import { listAuditEvents } from "@mcp-code-worker/core";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({
  limit: z.number().int().positive().max(100).optional()
});

export const cwListAuditEventsTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof listAuditEvents>>
> = {
  name: "cw_list_audit_events",
  description: "List local audit events in reverse chronological order.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveToolContext();
    return listAuditEvents(
      context.rootDir,
      args.limit ?? 50,
      context.cwStorageDir
    );
  }
};
