import { describe, expect, it } from "vitest";

import type { AgentTask, WorkerTaskType } from "@mcp-code-worker/core";
import {
  buildWorkerTaskContractResultOptions,
  getWorkerTaskContract,
  listWorkerTaskContracts
} from "@mcp-code-worker/graph";

const taskTypes: WorkerTaskType[] = [
  "summarization",
  "log-analysis",
  "json-extraction",
  "doc-generation",
  "review-lite",
  "risk-analysis",
  "code-understanding",
  "codegen",
  "validation-fix",
  "test-generation",
  "patch-generation"
];

const task: AgentTask = {
  id: "task-1",
  goal: "Inspect repository behavior",
  input: {
    repositoryContext: {
      rootDir: "/repo",
      scope: "packages/core",
      requestedFiles: ["packages/core/src/index.ts"],
      skippedFiles: [],
      coverageGapDetected: false,
      strictFiles: true,
      warnings: [],
      selectionReasons: [],
      selectedFiles: [
        {
          path: "packages/core/src/index.ts",
          content: "export const value = 1;",
          truncated: false
        }
      ]
    }
  },
  constraints: [],
  assignedRole: "worker",
  priority: "medium",
  metadata: {}
};

describe("WorkerTaskContract registry", () => {
  it("registers every first-phase non-patch worker task type", () => {
    for (const taskType of taskTypes) {
      expect(getWorkerTaskContract(taskType).taskTypes).toContain(taskType);
    }
  });

  it("keeps contracts as the single source for worker capabilities", () => {
    for (const contract of listWorkerTaskContracts()) {
      expect(contract.capability.outputSchema).toBe(contract.outputSchema);
      expect(contract.capability.supportedTaskTypes).toEqual(contract.taskTypes);
      expect(contract.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    }
  });

  it("builds repository-grounded prompts and schema-valid fallbacks", () => {
    const contract = getWorkerTaskContract("review-lite");
    const options = buildWorkerTaskContractResultOptions(contract, {
      task,
      scope: "packages/core"
    });

    expect(options.prompt).toContain("packages/core/src/index.ts");
    expect(options.prompt).toContain("Allowed referencedFiles values");
    expect(contract.outputSchema.safeParse(options.fallbackOutput).success).toBe(
      true
    );
  });
});
