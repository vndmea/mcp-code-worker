import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  runHostWorkerWorkflow,
  runWorkerInterviewWorkflow
} from "@agent-orchestrator/graph";

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
    expect(result.qualityGate.workflowStatus).toBe("completed");
    expect(result.qualityGate.answerStatus).toBe("complete");
    expect(result.finalResult.status).toBe("success");
  });

  it("fails fast when strict file mode cannot fit explicit files into the budget", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, "packages", "core", "src", "wide.ts"),
      "export const wide = '".concat("x".repeat(200), "';\n"),
      "utf8"
    );

    await expect(
      runHostWorkerWorkflow({
        context: createExecutionContextFromEnv(undefined, {
          dryRun: true,
          allowWrite: false,
          rootDir
        }),
        goal: "Review explicit files only",
        taskType: "review-lite",
        files: [
          "packages/core/src/generateId.ts",
          "packages/core/src/wide.ts"
        ],
        maxFileBytes: 120,
        maxTotalBytes: 140,
        strictFiles: true
      })
    ).rejects.toMatchObject({
      code: "REPOSITORY_CONTEXT_LIMIT_EXCEEDED",
      details: {
        strictFiles: true
      }
    });
  });

  it("marks answers incomplete when repository coverage has gaps", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, "packages", "core", "src", "extra.ts"),
      "export const extra = '".concat("x".repeat(200), "';\n"),
      "utf8"
    );

    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite",
      maxFileBytes: 200,
      maxTotalBytes: 120
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.repositoryContext.coverageGapDetected).toBe(true);
    expect(result.qualityGate.coverageGapDetected).toBe(true);
    expect(result.qualityGate.answerStatus).toBe("incomplete");
    expect(result.qualityGate.failureStages).toContain("coverage-gap");
    expect(result.debug.promptTransparency.hostPrompt).toContain("Review the selected files");
    expect(result.debug.promptTransparency.workerPrompt).toContain("Return JSON");
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
