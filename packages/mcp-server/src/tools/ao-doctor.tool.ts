import { z } from "zod";

import {
  resolveExecutionContext,
  runDoctor,
  writeAuditEvent
} from "@agent-orchestrator/core";
import { createWorkerProfileDoctorChecks } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const aoDoctorTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runDoctor>>
> = {
  name: "ao_doctor",
  description: "Inspect resolved configuration and local workflow prerequisites.",
  inputSchema,
  execute: async () => {
    const context = await resolveExecutionContext();
    const report = await runDoctor(context, {
      additionalChecks: await createWorkerProfileDoctorChecks(context)
    });
    await writeAuditEvent(context, {
      actor: "mcp",
      action: "tool-call",
      mode: context.dryRun ? "dry-run" : "execute",
      tool: "ao_doctor",
      inputSummary: "ao_doctor",
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
