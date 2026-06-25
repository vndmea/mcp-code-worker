import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";

import { aoDoctorTool } from "./tools/ao-doctor.tool.js";
import { aoFixErrorTool } from "./tools/ao-fix-error.tool.js";
import { aoGetWorkerProfileTool } from "./tools/ao-get-worker-profile.tool.js";
import { aoInterviewWorkerTool } from "./tools/ao-interview-worker.tool.js";
import { aoListAuditEventsTool } from "./tools/ao-list-audit-events.tool.js";
import { aoListModelsTool } from "./tools/ao-list-models.tool.js";
import { aoListToolsTool } from "./tools/ao-list-tools.tool.js";
import { aoListWorkersTool } from "./tools/ao-list-workers.tool.js";
import { aoListWorkflowsTool } from "./tools/ao-list-workflows.tool.js";
import { aoPlanTool } from "./tools/ao-plan.tool.js";
import { aoReviewDiffTool } from "./tools/ao-review-diff.tool.js";
import { aoRunLeaderWorkerTool } from "./tools/ao-run-leader-worker.tool.js";
import { aoRunWorkflowTool } from "./tools/ao-run-workflow.tool.js";

export const aoToolDefinitions = [
  aoPlanTool,
  aoRunWorkflowTool,
  aoRunLeaderWorkerTool,
  aoReviewDiffTool,
  aoFixErrorTool,
  aoListModelsTool,
  aoListWorkflowsTool,
  aoListToolsTool,
  aoListAuditEventsTool,
  aoInterviewWorkerTool,
  aoListWorkersTool,
  aoGetWorkerProfileTool,
  aoDoctorTool
] as const;

export const createAoMcpServer = () => {
  const context = createExecutionContextFromEnv();
  const server = new McpServer({
    name: context.serverName,
    version: context.serverVersion
  });

  aoToolDefinitions.forEach((tool) => {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (args: unknown) => {
        const result = await tool.execute(args as never);
        const structuredContent =
          typeof result === "object" && result !== null
            ? (result as Record<string, unknown>)
            : { result };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ],
          structuredContent
        };
      }
    );
  });

  return server;
};

export const serveAoMcpServer = async (): Promise<void> => {
  const server = createAoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
