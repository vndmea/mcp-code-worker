import { z } from "zod";

import { createExecutionContextFromEnv, writeAuditEvent } from "@agent-orchestrator/core";
import { runLeaderWorkerWorkflow } from "@agent-orchestrator/graph";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  goal: z.string().min(1),
  scope: z.string().optional(),
  workerId: z.string().optional(),
  requireProfile: z.boolean().optional()
});

export const aoRunLeaderWorkerTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runLeaderWorkerWorkflow>>
> = {
  name: "ao_run_leader_worker",
  description: "Run the leader-worker workflow with optional worker profile requirements.",
  inputSchema,
  execute: async (args) => {
    const context = createExecutionContextFromEnv();
    const result = await runLeaderWorkerWorkflow({
      context,
      goal: args.goal,
      requireProfile: args.requireProfile,
      scope: args.scope,
      workerId: args.workerId
    });
    await writeAuditEvent(context, {
      actor: "mcp",
      action: "tool-call",
      mode: context.dryRun ? "dry-run" : "execute",
      tool: "ao_run_leader_worker",
      inputSummary: args.goal,
      outputSummary: "Leader-worker MCP workflow completed.",
      warnings: result.state.warnings,
      errors: result.state.errors,
      metadata: {
        requireProfile: args.requireProfile,
        scope: args.scope,
        workerId: args.workerId
      }
    });
    return result;
  }
};
