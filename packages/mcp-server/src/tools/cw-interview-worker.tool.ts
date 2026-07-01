import { z } from "zod";

import { runWorkerInterviewOnboarding } from "@mcp-code-worker/graph";

import {
  createAllowWriteCliOverrides,
  resolveToolContext
} from "./tool-runtime.js";
import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  persistProfile: z.boolean().optional()
});

type WorkerInterviewToolResult = Awaited<
  ReturnType<typeof runWorkerInterviewOnboarding>
>;

const executeWorkerInterview = async (
  args: z.infer<typeof inputSchema>
): Promise<WorkerInterviewToolResult> => {
  const context = await resolveToolContext({
    cliOverrides: createAllowWriteCliOverrides(args.persistProfile ?? false)
  });
  return runWorkerInterviewOnboarding({
    baseURL: args.baseURL,
    context,
    model: args.model,
    persistProfile: args.persistProfile ?? false,
    provider: args.provider,
    workerId: args.workerId
  });
};

const workerInterviewDescription =
  "Run a fresh worker interview, generate a capability profile, and optionally persist it.";

export const cwRunWorkerInterviewTool: CwToolDefinition<
  typeof inputSchema.shape,
  WorkerInterviewToolResult
> = {
  name: "cw_run_worker_interview",
  description: workerInterviewDescription,
  inputSchema,
  execute: executeWorkerInterview
};

export const cwInterviewWorkerTool: CwToolDefinition<
  typeof inputSchema.shape,
  WorkerInterviewToolResult
> = {
  name: "cw_interview_worker",
  description:
    "Alias for cw_run_worker_interview. Evaluate a worker model, generate a capability profile, and optionally persist it.",
  inputSchema,
  execute: executeWorkerInterview
};
