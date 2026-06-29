import { z } from "zod";

import {
  buildDoctorReport
} from "@mcp-code-worker/models";

import {
  createHostMcpDoctorChecks
} from "./host-mcp-doctor.js";
import {
  isMcpHost,
  MCP_HOSTS,
  type McpHost
} from "./mcp-host-config.js";
import {
  resolveToolContext,
  writeToolAuditEvent
} from "./tool-runtime.js";
import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  host: z.enum(MCP_HOSTS).optional(),
  mcp: z.boolean().optional(),
  probe: z.boolean().optional(),
  workerId: z.string().min(1).optional()
});

export const cwDoctorTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof buildDoctorReport>>
> = {
  name: "cw_doctor",
  description: "Inspect resolved configuration and local workflow prerequisites.",
  inputSchema,
  execute: async (args) => {
    const requestedHost = args.host ?? "codex";
    const runHostChecks = args.mcp === true || args.host !== undefined;

    if (runHostChecks && !isMcpHost(requestedHost)) {
      throw new Error(
        `Unsupported MCP host '${requestedHost}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
      );
    }

    const context = await resolveToolContext();
    const hostChecks = runHostChecks
      ? await createHostMcpDoctorChecks(context, requestedHost as McpHost)
      : [];
    const report = await buildDoctorReport({
      additionalChecks: hostChecks,
      context,
      hostMcpHost: runHostChecks ? requestedHost : undefined,
      probe: args.probe,
      workerId: args.workerId
    });
    await writeToolAuditEvent({
      context,
      tool: "cw_doctor",
      inputSummary:
        `cw_doctor${args.workerId ? ` worker=${args.workerId}` : ""}${args.probe ? " probe=true" : ""}${runHostChecks ? ` mcp=true host=${requestedHost}` : ""}`,
      outputSummary: `Doctor completed with ok=${String(report.ok)}.`,
      warnings: report.checks
        .filter((check) => check.status === "warning")
        .map((check) => check.message),
      errors: report.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.message)
    });
    return report;
  }
};
