import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  runHostWorkerWorkflow,
  runWorkerInterviewWorkflow
} from "@agent-orchestrator/graph";
import { runLeaderWorkerWorkflow } from "./leader-worker-workflow.js";
import { runPlanningWorkflow } from "./planning-workflow.js";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-host-worker-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "src", "generateId.ts"),
    "export const generateId = () => 'id';\n",
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "schemaMinimum.ts"),
    "export const schemaMinimum = 1;\n",
    "utf8"
  );
  return rootDir;
};

describe("planning workflow", () => {
  it("produces a structured plan with risks and validation strategy", async () => {
    const result = await runPlanningWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      }),
      goal: "Create a new orchestration package"
    });

    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.riskList.length).toBeGreaterThan(0);
    expect(result.validationStrategy.length).toBeGreaterThan(0);
  });
});

describe("leader-worker workflow", () => {
  it("transitions through planning, worker execution, and final review", async () => {
    const result = await runLeaderWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      }),
      goal: "Draft tests for workflow routing"
    });

    expect(result.state.plan).not.toBeNull();
    expect(result.state.workerResults).toHaveLength(4);
    expect(result.state.workerCapabilityProfile?.status).toBe("active");
    expect(result.state.toolResults.length).toBeGreaterThan(0);
    expect(result.finalResult?.status).toBe("needs_review");
  });
});

describe("host worker workflow", () => {
  it("runs one explicit worker task without creating an internal plan", async () => {
    const rootDir = await createWorkspace();
    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite",
      files: [
        "packages/core/src/generateId.ts",
        "packages/core/src/schemaMinimum.ts"
      ]
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.repositoryContext.selectedFiles).toHaveLength(2);
    expect((result.workerResult?.output as { answer?: string }).answer).toContain(
      "packages/core/src/generateId.ts"
    );
    expect(result.qualityGate.missingRequestedFiles).toEqual([]);
    expect(result.qualityGate.genericFallbackDetected).toBe(false);
    expect(result.finalResult.status).toBe("success");
  });
});

describe("worker interview workflow", () => {
  it("returns a capability profile and task results", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      })
    });

    expect(result.profile.workerId).toContain("mock");
    expect(result.taskResults.length).toBeGreaterThan(0);
  });
});
