import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { runWorkerInterviewWorkflow } from "@agent-orchestrator/graph";
import {
  getWorkerRegistration,
  resolveWorkerModel,
  saveWorkerProfile
} from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({
  workerId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  baseURL: z.string().optional(),
  persistProfile: z.boolean().optional()
});

export const aoInterviewWorkerTool: AoToolDefinition<
  typeof inputSchema.shape,
  Awaited<ReturnType<typeof runWorkerInterviewWorkflow>> & {
    persistence?:
      | { mode: "execute" | "dry-run"; path: string }
      | {
          mode: "skipped";
          reason: string;
          recommendedActions: string[];
        };
  }
> = {
  name: "ao_interview_worker",
  description:
    "Evaluate a worker model, generate a capability profile, and optionally persist it.",
  inputSchema,
  execute: async (args) => {
    const context = await resolveExecutionContext();
    const hasModelOverride =
      Boolean(args.provider) || Boolean(args.model) || Boolean(args.baseURL);
    const registeredWorker = args.workerId
      ? await getWorkerRegistration(context.rootDir, args.workerId)
      : null;
    const resolved = registeredWorker
      ? await resolveWorkerModel({
          context,
          workerId: args.workerId
        })
      : null;

    if (args.workerId && !registeredWorker && !hasModelOverride) {
      throw new Error(`Worker ${args.workerId} is not registered.`);
    }

    const modelConfig = resolved?.modelConfig ?? {
      ...context.workerModel,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.baseURL ? { baseURL: args.baseURL } : {})
    };
    const result = await runWorkerInterviewWorkflow({
      context,
      workerId: resolved?.workerId ?? args.workerId,
      modelConfig
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
  }
};
