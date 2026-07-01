import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@mcp-code-worker/core";
import { CodexHostAdapter } from "@mcp-code-worker/graph";

const repositoryContext = {
  rootDir: "/repo",
  scope: "packages/core",
  files: [],
  selectedFiles: [
    {
      path: "packages/core/src/index.ts",
      content: "export const value = 1;",
      truncated: false,
      sizeBytes: 23
    }
  ],
  selectionReasons: [],
  requestedFiles: ["packages/core/src/index.ts"],
  skippedFiles: [],
  coverageGapDetected: false,
  strictFiles: true,
  warnings: [],
  generatedAt: new Date().toISOString()
};

describe("CodexHostAdapter", () => {
  it("builds a codex worker task envelope and legacy task bridge", () => {
    const context = createExecutionContextFromEnv(undefined, {
      workerModel: {
        provider: "openai-compatible",
        model: "deepseek-v4-pro"
      }
    });
    const result = new CodexHostAdapter().buildWorkerTask({
      context,
      goal: "Review selected files",
      repositoryContext,
      taskId: "task-envelope-1",
      taskType: "review-lite"
    });

    expect(result.envelope).toMatchObject({
      id: "task-envelope-1",
      taskType: "review-lite",
      host: "codex",
      outputContract: {
        contractId: "review-worker",
        schemaVersion: "1.0.0"
      }
    });
    expect(result.task.input).toMatchObject({
      scope: "packages/core",
      taskType: "review-lite"
    });
    expect(
      (result.task.input as { workerTaskEnvelope?: unknown }).workerTaskEnvelope
    ).toBe(result.envelope);
    expect(result.plannedTask.expectedArtifactType).toBe("review");
    expect(result.promptTransformation).toBe("augmented");
  });
});
