import type { ZodObject, ZodRawShape } from "zod";

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
import {
  cwInterviewWorkerTool,
  cwRunWorkerInterviewTool
} from "./cw-interview-worker.tool.js";
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

interface RegisteredCwToolDefinition {
  description: string;
  execute: (args: unknown) => unknown;
  inputSchema: ZodObject<ZodRawShape>;
  name: string;
}

const asRegisteredTool = <TArgs extends ZodRawShape, TResult>(
  tool: CwToolDefinition<TArgs, TResult>
): RegisteredCwToolDefinition =>
  tool as unknown as RegisteredCwToolDefinition;

export type McpToolCategory =
  | "diagnostics"
  | "high-level-task-entrypoints"
  | "management"
  | "workflow-building-blocks";

interface CwToolRegistryEntry {
  category: McpToolCategory;
  recommended?: boolean;
  tool: RegisteredCwToolDefinition;
}

export const cwToolRegistry: CwToolRegistryEntry[] = [
  {
    tool: asRegisteredTool(cwRunHostWorkerTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwProposePatchTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwInspectPatchTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwApplyPatchTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwReviewRepositoryTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwReviewDiffTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwReviewFilesTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwValidateRepositoryTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwFixErrorTool),
    category: "workflow-building-blocks"
  },
  {
    tool: asRegisteredTool(cwStartTaskTool),
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: asRegisteredTool(cwResumeTaskTool),
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: asRegisteredTool(cwGetTaskStatusTool),
    category: "high-level-task-entrypoints"
  },
  {
    tool: asRegisteredTool(cwListTasksTool),
    category: "high-level-task-entrypoints"
  },
  {
    tool: asRegisteredTool(cwGetTaskReportTool),
    category: "high-level-task-entrypoints",
    recommended: true
  },
  {
    tool: asRegisteredTool(cwReadTaskArtifactTool),
    category: "high-level-task-entrypoints"
  },
  {
    tool: asRegisteredTool(cwListModelsTool),
    category: "diagnostics"
  },
  {
    tool: asRegisteredTool(cwListWorkflowsTool),
    category: "diagnostics"
  },
  {
    tool: asRegisteredTool(cwListToolsTool),
    category: "diagnostics"
  },
  {
    tool: asRegisteredTool(cwListAuditEventsTool),
    category: "diagnostics"
  },
  {
    tool: asRegisteredTool(cwRegisterWorkerTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwUnregisterWorkerTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwListWorkerRegistryTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwGetWorkerRegistrationTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwRunWorkerInterviewTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwInterviewWorkerTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwBenchmarkWorkerTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwListWorkersTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwGetWorkerProfileTool),
    category: "management"
  },
  {
    tool: asRegisteredTool(cwDoctorTool),
    category: "diagnostics"
  }
];

export const cwToolDefinitions = cwToolRegistry.map((entry) => entry.tool);
