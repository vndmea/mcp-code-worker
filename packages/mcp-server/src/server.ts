import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError } from "zod";

import { AgentError, resolveExecutionContext } from "@agent-orchestrator/core";

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
import {
  aoInterviewWorkerTool,
  aoRunWorkerInterviewTool
} from "./tools/ao-interview-worker.tool.js";
import { aoListAuditEventsTool } from "./tools/ao-list-audit-events.tool.js";
import { aoListModelsTool } from "./tools/ao-list-models.tool.js";
import { aoListTasksTool } from "./tools/ao-list-tasks.tool.js";
import { aoListToolsTool } from "./tools/ao-list-tools.tool.js";
import { aoListWorkerRegistryTool } from "./tools/ao-list-worker-registry.tool.js";
import { aoListWorkersTool } from "./tools/ao-list-workers.tool.js";
import { aoListWorkflowsTool } from "./tools/ao-list-workflows.tool.js";
import { aoProposePatchTool } from "./tools/ao-propose-patch.tool.js";
import { aoRegisterWorkerTool } from "./tools/ao-register-worker.tool.js";
import { aoReviewDiffTool } from "./tools/ao-review-diff.tool.js";
import { aoReviewFilesTool } from "./tools/ao-review-files.tool.js";
import { aoReviewRepositoryTool } from "./tools/ao-review-repository.tool.js";
import { aoResumeTaskTool } from "./tools/ao-resume-task.tool.js";
import { aoRunHostWorkerTool } from "./tools/ao-run-host-worker.tool.js";
import { aoStartTaskTool } from "./tools/ao-start-task.tool.js";
import { aoUnregisterWorkerTool } from "./tools/ao-unregister-worker.tool.js";
import { aoValidateRepositoryTool } from "./tools/ao-validate-repository.tool.js";

export const aoToolDefinitions = [
  aoRunHostWorkerTool,
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
  aoRunWorkerInterviewTool,
  aoInterviewWorkerTool,
  aoBenchmarkWorkerTool,
  aoListWorkersTool,
  aoGetWorkerProfileTool,
  aoDoctorTool
] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const toStructuredContent = (result: unknown): Record<string, unknown> =>
  isPlainObject(result) ? result : { result };

export const formatUserFacingToolErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();

  if (error instanceof AgentError) {
    const userMessage =
      error.code === "TASK_SESSION_NOT_FOUND"
        ? "ao is connected to this workspace, but the requested task session was not found here."
        : error.code === "TASK_ARTIFACT_NOT_FOUND"
          ? "ao found the task session, but this artifact is not registered for it, so it cannot be read safely."
          : error.code === "TASK_PATCH_PROPOSAL_MISSING"
            ? "This step needs a stored patch proposal before it can continue."
            : error.code === "WRITE_BLOCKED"
              ? "ao refused to write because the current safety mode does not allow that path yet."
              : "ao reached the tool, but the request could not be completed cleanly.";

    return `${userMessage} Technical details: ${message}`;
  }

  if (error instanceof ZodError) {
    return `The service is connected, but the request or response shape does not match the expected schema. Technical details: ${message}`;
  }

  if (
    normalizedMessage.includes("expected record") &&
    normalizedMessage.includes("received array")
  ) {
    return `The service is connected, but this response format is incompatible with the current client expectation. Technical details: ${message}`;
  }

  if (
    (normalizedMessage.includes("config.json") ||
      normalizedMessage.includes("workspaces") ||
      normalizedMessage.includes("configuration")) &&
    (normalizedMessage.includes("invalid") ||
      normalizedMessage.includes("missing") ||
      normalizedMessage.includes("parse"))
  ) {
    return `The service is connected, but ao found a workspace or user-scoped storage configuration problem. Technical details: ${message}`;
  }

  if (
    normalizedMessage.includes("api key") ||
    normalizedMessage.includes("401") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("forbidden")
  ) {
    return `The service is connected, but the configured model credentials were rejected or are incomplete. Technical details: ${message}`;
  }

  return `ao reached the tool, but it failed unexpectedly. Technical details: ${message}`;
};

const toUserFacingToolError = (error: unknown): Error => {
  return new Error(formatUserFacingToolErrorMessage(error));
};

export interface AoMcpServerOptions {
  rootDir?: string;
}

export const createAoMcpServer = async (
  options: AoMcpServerOptions = {}
) => {
  const context = await resolveExecutionContext({
    ...(options.rootDir ? { rootDir: options.rootDir } : {})
  });
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
        try {
          const result = await tool.execute(args as never);
          const structuredContent = toStructuredContent(result);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2)
              }
            ],
            structuredContent
          };
        } catch (error) {
          throw toUserFacingToolError(error);
        }
      }
    );
  });

  return server;
};

export const serveAoMcpServer = async (
  options: AoMcpServerOptions = {}
): Promise<void> => {
  const server = await createAoMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
