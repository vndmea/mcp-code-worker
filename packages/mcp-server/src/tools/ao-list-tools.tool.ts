import { z } from "zod";

import type { AoToolDefinition } from "./tool-types.js";
import { mcpToolCatalog } from "./mcp-tool-catalog.js";

const inputSchema = z.object({});

export const aoListToolsTool: AoToolDefinition<
  typeof inputSchema.shape,
  typeof mcpToolCatalog
> = {
  name: "ao_list_tools",
  description: "List MCP tool definitions exposed by the server.",
  inputSchema,
  execute: () => mcpToolCatalog
};
