import { z } from "zod";

import { graphWorkflowCatalog } from "@mcp-code-worker/graph";

import type { CwToolDefinition } from "./tool-types.js";

const inputSchema = z.object({});

export const cwListWorkflowsTool: CwToolDefinition<
  typeof inputSchema.shape,
  typeof graphWorkflowCatalog
> = {
  name: "cw_list_workflows",
  description: "List host-managed workflows that remain available through public cw tools.",
  inputSchema,
  execute: () => graphWorkflowCatalog
};
