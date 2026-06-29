import { z } from "zod";

import { ModelRouter } from "@mcp-code-worker/models";

import type { CwToolDefinition } from "./tool-types.js";
import { resolveToolContext } from "./tool-runtime.js";

const inputSchema = z.object({});

export const cwListModelsTool: CwToolDefinition<
  typeof inputSchema.shape,
  ReturnType<ModelRouter["listModels"]>
> = {
  name: "cw_list_models",
  description: "List configured worker models.",
  inputSchema,
  execute: async () => {
    const context = await resolveToolContext();
    const router = new ModelRouter(context.workerModel);
    return router.listModels();
  }
};
