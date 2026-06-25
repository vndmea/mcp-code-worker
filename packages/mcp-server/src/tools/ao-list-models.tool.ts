import { z } from "zod";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { ModelRouter } from "@agent-orchestrator/models";

import type { AoToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const aoListModelsTool: AoToolDefinition<
  typeof inputSchema.shape,
  ReturnType<ModelRouter["listModels"]>
> = {
  name: "ao_list_models",
  description: "List configured leader and worker models.",
  inputSchema,
  execute: async () => {
    const context = await resolveExecutionContext();
    const router = new ModelRouter(context.leaderModel, context.workerModel);
    return router.listModels();
  }
};
