import type { ZodRawShape } from "zod";

import { cwBenchmarkWorkerTool } from "./cw-benchmark-worker.tool.js";
import { cwDoctorTool } from "./cw-doctor.tool.js";
import { cwApplyPatchTool } from "./cw-apply-patch.tool.js";
import { cwFixErrorTool } from "./cw-fix-error.tool.js";
import { cwGetTaskReportTool } from "./cw-get-task-report.tool.js";
import { cwGetTaskStatusTool } from "./cw-get-task-status.tool.js";
import { cwReadTaskArtifactTool } from "./cw-read-task-artifact.tool.js";
import { cwGetWorkerRegistrationTool } from "./cw-get-worker-registration.tool.js";
import { cwGetWorkerProfileTool } from "./cw-get-worker-profile.tool.js";
import { cwInspectPatchTool } from "./cw-inspect-patch.tool.js";
import { cwRunWorkerInterviewTool } from "./cw-interview-worker.tool.js";
import { cwListAuditEventsTool } from "./cw-list-audit-events.tool.js";
import { cwListModelsTool } from "./cw-list-models.tool.js";
import { cwListTasksTool } from "./cw-list-tasks.tool.js";
import { cwListToolsTool } from "./cw-list-tools.tool.js";
import { cwListWorkerRegistryTool } from "./cw-list-worker-registry.tool.js";
import { cwListWorkersTool } from "./cw-list-workers.tool.js";
import { cwListWorkflowsTool } from "./cw-list-workflows.tool.js";
import { cwProposePatchTool } from "./cw-propose-patch.tool.js";
import { cwRegisterWorkerTool } from "./cw-register-worker.tool.js";
import { cwReviewDiffTool } from "./cw-review-diff.tool.js";
import { cwReviewFilesTool } from "./cw-review-files.tool.js";
import { cwReviewRepositoryTool } from "./cw-review-repository.tool.js";
import { cwResumeTaskTool } from "./cw-resume-task.tool.js";
import { cwRunHostWorkerTool } from "./cw-run-host-worker.tool.js";
import { cwStartTaskTool } from "./cw-start-task.tool.js";
import { cwUnregisterWorkerTool } from "./cw-unregister-worker.tool.js";
import { cwValidateRepositoryTool } from "./cw-validate-repository.tool.js";
import type { CwToolDefinition } from "./tool-types.js";

export type McpToolCategory =
  | "diagnostics"
  | "high-level-task-entrypoints"
  | "management"
  | "workflow-building-blocks";

interface CwToolRegistryEntry {
  category: McpToolCategory;
  recommended?: boolean;
  tool: CwToolDefinition<ZodRawShape, unknown>;
}

export const cwToolRegistry: CwToolRegistryEntry[] = [
  {
    tool: cwRunHostWorkerTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwProposePatchTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwInspectPatchTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwApplyPatchTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwReviewRepositoryTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwReviewDiffTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwReviewFilesTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwValidateRepositoryTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwFixErrorTool,
    category: "workflow-building-blocks"
  },
  {
    tool: cwStartTaskTool,
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: cwResumeTaskTool,
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: cwGetTaskStatusTool,
    category: "high-level-task-entrypoints"
  },
  {
    tool: cwListTasksTool,
    category: "high-level-task-entrypoints"
  },
  {
    tool: cwGetTaskReportTool,
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: cwReadTaskArtifactTool,
    category: "high-level-task-entrypoints"
  },
  {
    tool: cwListModelsTool,
    category: "diagnostics"
  },
  {
    tool: cwListWorkflowsTool,
    category: "diagnostics"
  },
  {
    tool: cwListToolsTool,
    category: "diagnostics"
  },
  {
    tool: cwListAuditEventsTool,
    category: "diagnostics"
  },
  {
    tool: cwRegisterWorkerTool,
    category: "management"
  },
  {
    tool: cwUnregisterWorkerTool,
    category: "management"
  },
  {
    tool: cwListWorkerRegistryTool,
    category: "management"
  },
  {
    tool: cwGetWorkerRegistrationTool,
    category: "management"
  },
  {
    tool: cwRunWorkerInterviewTool,
    category: "management"
  },
  {
    tool: cwBenchmarkWorkerTool,
    category: "management"
  },
  {
    tool: cwListWorkersTool,
    category: "management"
  },
  {
    tool: cwGetWorkerProfileTool,
    category: "management"
  },
  {
    tool: cwDoctorTool,
    category: "diagnostics"
  }
];

export const cwToolDefinitions = cwToolRegistry.map((entry) => entry.tool);
