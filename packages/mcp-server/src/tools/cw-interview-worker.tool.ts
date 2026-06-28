import { z } from "zod";

import { resolveExecutionContext } from "@mcp-code-worker/core";
import { runWorkerInterviewWorkflow } from "@mcp-code-worker/graph";
import {
  resolveWorkerTarget,
  saveWorkerProfile
} from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  persistProfile: z.boolean().optional()
});

type WorkerInterviewToolResult = Awaited<
  ReturnType<typeof runWorkerInterviewWorkflow>
> & {
  persistence?:
    | { mode: "execute" | "dry-run"; path: string }
    | {
        mode: "skipped";
        reason: string;
        recommendedActions: string[];
      };
};

const executeWorkerInterview = async (
  args: z.infer<typeof inputSchema>
): Promise<WorkerInterviewToolResult> => {
  const context = await resolveExecutionContext();
  const resolvedTarget = await resolveWorkerTarget({
    context,
    workerId: args.workerId,
    provider: args.provider,
    model: args.model,
    baseURL: args.baseURL,
    requireNamedWorker: args.persistProfile
  });
  const result = await runWorkerInterviewWorkflow({
    context,
    workerId: resolvedTarget.workerId,
    modelConfig: resolvedTarget.modelConfig
  });
  const persistence = args.persistProfile
    ? result.persistenceAdvice.canPersist
      ? await saveWorkerProfile(context, result.profile, true)
      : {
          mode: "skipped" as const,
          reason: result.persistenceAdvice.reason,
          recommendedActions: result.persistenceAdvice.recommendedActions
        }
    : undefined;

  return {
    ...result,
    ...(persistence ? { persistence } : {})
  };
};

export const cwRunWorkerInterviewTool: CwToolDefinition<
  typeof inputSchema.shape,
  WorkerInterviewToolResult
> = {
  name: "cw_run_worker_interview",
  description:
    "Run a fresh worker interview, generate a capability profile, and optionally persist it.",
  inputSchema,
  execute: executeWorkerInterview
};
