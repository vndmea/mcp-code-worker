import { z } from "zod";

import { resolveExecutionContext, writeAuditEvent } from "@agent-orchestrator/core";
import { runHostWorkerWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  files: z.array(z.string()).optional(),
  goal: z.string().min(1),
  maxFileBytes: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional(),
  scope: z.string().optional(),
  strictFiles: z.boolean().optional(),
  taskType: z.enum([
    "summarization",
    "codegen",
    "test-generation",
    "log-analysis",
    "json-extraction",
    "review-lite"
  ]),
  workerId: z.string().optional(),
  requireProfile: z.boolean().optional()
});

export const aoRunHostWorkerTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runHostWorkerWorkflow>>
> = {
  name: "ao_run_host_worker",
  description:
    "Run one explicit worker task under host control without introducing another decision-making surface.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runHostWorkerWorkflow({
      context,
      files: args.files,
      goal: args.goal,
      maxFileBytes: args.maxFileBytes,
      maxTotalBytes: args.maxTotalBytes,
      requireProfile: args.requireProfile,
      scope: args.scope,
      strictFiles: args.strictFiles,
      taskType: args.taskType,
      workerId: args.workerId
    });
    await writeAuditEvent(context, {
      actor: "mcp",
      action: "tool-call",
      mode: context.dryRun ? "dry-run" : "execute",
      tool: "ao_run_host_worker",
      inputSummary: args.goal,
      outputSummary: "Host-managed worker MCP workflow completed.",
      warnings: result.warnings,
      errors: result.errors,
      metadata: {
        files: args.files,
        maxFileBytes: args.maxFileBytes,
        maxTotalBytes: args.maxTotalBytes,
        requireProfile: args.requireProfile,
        scope: args.scope,
        strictFiles: args.strictFiles,
        taskType: args.taskType,
        workerId: args.workerId
      }
    });
    return result;
  }
};
