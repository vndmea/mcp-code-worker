import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveExecutionContext } from "@agent-orchestrator/core";

import { aoBenchmarkWorkerTool } from "./tools/ao-benchmark-worker.tool.js";
import { aoDoctorTool } from "./tools/ao-doctor.tool.js";
import { aoApplyPatchTool } from "./tools/ao-apply-patch.tool.js";
import { aoFixErrorTool } from "./tools/ao-fix-error.tool.js";
import { aoGetTaskReportTool } from "./tools/ao-get-task-report.tool.js";
import { aoGetTaskStatusTool } from "./tools/ao-get-task-status.tool.js";
import { aoReadTaskArtifactTool } from "./tools/ao-read-task-artifact.tool.js";
import { aoGetWorkerRegistrationTool } from "./tools/ao-get-worker-registration.tool.js";
import { aoGetWorkerProfileTool } from "./tools/ao-get-worker-profile.tool.js";
import { aoInspectPatchTool } from "./tools/ao-inspect-patch.tool.js";
import { aoInterviewWorkerTool } from "./tools/ao-interview-worker.tool.js";
import { aoListAuditEventsTool } from "./tools/ao-list-audit-events.tool.js";
import { aoListModelsTool } from "./tools/ao-list-models.tool.js";
import { aoListTasksTool } from "./tools/ao-list-tasks.tool.js";
import { aoListToolsTool } from "./tools/ao-list-tools.tool.js";
import { aoListWorkerRegistryTool } from "./tools/ao-list-worker-registry.tool.js";
import { aoListWorkersTool } from "./tools/ao-list-workers.tool.js";
import { aoListWorkflowsTool } from "./tools/ao-list-workflows.tool.js";
import { aoPlanTool } from "./tools/ao-plan.tool.js";
import { aoProposePatchTool } from "./tools/ao-propose-patch.tool.js";
import { aoRegisterWorkerTool } from "./tools/ao-register-worker.tool.js";
import { aoReviewDiffTool } from "./tools/ao-review-diff.tool.js";
import { aoReviewFilesTool } from "./tools/ao-review-files.tool.js";
import { aoReviewRepositoryTool } from "./tools/ao-review-repository.tool.js";
import { aoResumeTaskTool } from "./tools/ao-resume-task.tool.js";
import { aoRunLeaderWorkerTool } from "./tools/ao-run-leader-worker.tool.js";
import { aoRunWorkflowTool } from "./tools/ao-run-workflow.tool.js";
import { aoStartTaskTool } from "./tools/ao-start-task.tool.js";
import { aoUnregisterWorkerTool } from "./tools/ao-unregister-worker.tool.js";
import { aoValidateRepositoryTool } from "./tools/ao-validate-repository.tool.js";

export const aoToolDefinitions = [
  aoPlanTool,
  aoRunWorkflowTool,
  aoRunLeaderWorkerTool,
  aoProposePatchTool,
  aoInspectPatchTool,
  aoApplyPatchTool,
  aoReviewRepositoryTool,
  aoReviewDiffTool,
  aoReviewFilesTool,
  aoValidateRepositoryTool,
  aoFixErrorTool,
  aoStartTaskTool,
  aoResumeTaskTool,
  aoGetTaskStatusTool,
  aoListTasksTool,
  aoGetTaskReportTool,
  aoReadTaskArtifactTool,
  aoListModelsTool,
  aoListWorkflowsTool,
  aoListToolsTool,
  aoListAuditEventsTool,
  aoRegisterWorkerTool,
  aoUnregisterWorkerTool,
  aoListWorkerRegistryTool,
  aoGetWorkerRegistrationTool,
  aoInterviewWorkerTool,
  aoBenchmarkWorkerTool,
  aoListWorkersTool,
  aoGetWorkerProfileTool,
  aoDoctorTool
] as const;

export const createAoMcpServer = async () => {
  const context = await resolveExecutionContext();
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
  const server = await createAoMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
