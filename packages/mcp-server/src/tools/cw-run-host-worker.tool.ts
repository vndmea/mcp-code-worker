import { z } from "zod";

import { resolveExecutionContext, writeAuditEvent } from "@mcp-code-worker/core";
import { runHostWorkerWorkflow } from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  files: z.array(z.string()).optional(),
  forceExecution: z.boolean().optional(),
  goal: z.string().min(1),
  scope: z.string().optional(),
  strictFiles: z.boolean().optional(),
  taskType: z.enum([
    "summarization",
    "code-understanding",
    "review-lite",
    "risk-analysis",
    "codegen",
    "test-generation",
    "validation-fix",
    "log-analysis",
    "json-extraction",
    "doc-generation"
  ]),
  workerId: z.string().min(1),
  requireProfile: z.boolean().optional()
});

export const cwRunHostWorkerTool: CwToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runHostWorkerWorkflow>>
> = {
  name: "cw_run_host_worker",
  description:
    "Run one explicit worker task under host control without introducing another decision-making surface.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const result = await runHostWorkerWorkflow({
      context,
      files: args.files,
      forceExecution: args.forceExecution,
      goal: args.goal,
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
      tool: "cw_run_host_worker",
      inputSummary: args.goal,
      outputSummary: "Host-managed worker MCP workflow completed.",
      warnings: result.warnings,
      errors: result.errors,
      metadata: {
        files: args.files,
        forceExecution: args.forceExecution,
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
