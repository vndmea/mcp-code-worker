import { describe, expect, it } from "vitest";

import type { ModelConfig } from "@agent-orchestrator/core";
import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  ReviewWorker,
  SummarizeWorker,
  TestWorker,
  type WorkerAgent
} from "@agent-orchestrator/graph";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelProvider
} from "@agent-orchestrator/models";

class SequenceProvider implements ModelProvider {
  public readonly name = "sequence";

  public constructor(
    private readonly responses: ModelInvocationResult[]
  ) {}

  public invoke(
    config: ModelConfig,
    request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    void config;
    void request;

    return Promise.resolve(this.responses.shift() ?? {
      provider: "sequence",
      model: "test-model",
      text: "{}"
    });
  }
}

const patchWorkerProvider = (
  worker: WorkerAgent,
  provider: ModelProvider
): void => {
  const router = (worker as unknown as {
    router: { providers: Map<string, ModelProvider> };
  }).router;
  router.providers.set("mock", provider);
};

describe("WorkerAgent structured outputs", () => {
  it("uses parsed provider output as worker output", async () => {
    const worker = new SummarizeWorker(
      createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      })
    );
    patchWorkerProvider(
      worker,
      new SequenceProvider([
        {
          provider: "sequence",
          model: "test-model",
          text: JSON.stringify({
            brief: "Provider summary",
            focusAreas: ["Inspect worker routing"]
          })
        }
      ])
    );

    const result = await worker.execute({
      task: {
        id: "task-1",
        goal: "Summarize the workflow",
        assignedRole: "reviewer",
        priority: "high",
        constraints: [],
        metadata: {}
      },
      scope: "packages/graph"
    });

    expect(result.status).toBe("success");
    expect(result.output).toEqual({
      brief: "Provider summary",
      focusAreas: ["Inspect worker routing"]
    });
    expect(result.metadata["prompt"]).toBeTypeOf("string");
    expect(result.metadata["rawText"]).toBeTypeOf("string");
    expect(result.artifacts.some((artifact) => artifact.name === "worker-debug.json")).toBe(true);
  });

  it("falls back and exposes structured invocation errors for invalid worker output", async () => {
    const worker = new TestWorker(
      createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      })
    );
    patchWorkerProvider(
      worker,
      new SequenceProvider([
        {
          provider: "sequence",
          model: "test-model",
          text: '{"suggestedTests":"not-an-array"}'
        }
      ])
    );

    const result = await worker.execute({
      task: {
        id: "task-2",
        goal: "Suggest tests",
        assignedRole: "reviewer",
        priority: "high",
        constraints: [],
        metadata: {}
      }
    });

    expect(result.status).toBe("needs_review");
    expect(result.output).toEqual({
      suggestedTests: [
        "Validate schema parsing for structured workflow outputs.",
        "Validate state transitions for host-managed review and task-session workflows.",
        "Validate write and shell safety policies."
      ]
    });
    expect(result.risks.some((risk) => risk.includes("schema validation failed"))).toBe(true);
    expect(result.metadata["failureKind"]).toBe("schema-validation");
    expect((result.metadata["structuredOutputErrors"] as string[]).length).toBeGreaterThan(0);
  });

  it("retries strict review outputs and succeeds after a repair attempt", async () => {
    const worker = new ReviewWorker(
      createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      })
    );
    patchWorkerProvider(
      worker,
      new SequenceProvider([
        {
          provider: "sequence",
          model: "test-model",
          text: JSON.stringify({
            answer: "partial",
            findings: "packages/core/src/generateId.ts may still drift",
            referencedFiles: ["packages/core/src/generateId.ts"],
            verdict: "partial"
          })
        },
        {
          provider: "sequence",
          model: "test-model",
          text: JSON.stringify({
            answer:
              "The fix looks partial until packages/core/src/generateId.ts is verified end to end.",
            findings: [
              "packages/core/src/generateId.ts should be checked for initialization-time id generation gaps.",
              "packages/core/src/schemaMinimum.ts should preserve schema-valid id backfilling."
            ],
            referencedFiles: [
              "packages/core/src/generateId.ts",
              "packages/core/src/schemaMinimum.ts"
            ]
          })
        }
      ])
    );

    const result = await worker.execute({
      task: {
        id: "task-3",
        goal: "Decide whether the fix is complete or partial",
        assignedRole: "reviewer",
        priority: "high",
        constraints: [],
        metadata: {},
        input: {
          repositoryContext: {
            scope: "packages/core/src",
            requestedFiles: [
              "packages/core/src/generateId.ts",
              "packages/core/src/schemaMinimum.ts"
            ],
            skippedFiles: [],
            coverageGapDetected: false,
            strictFiles: true,
            warnings: [],
            selectedFiles: [
              {
                path: "packages/core/src/generateId.ts",
                content: "export const generateId = () => 'id';",
                truncated: false
              },
              {
                path: "packages/core/src/schemaMinimum.ts",
                content: "export const schemaMinimum = 1;",
                truncated: false
              }
            ]
          }
        }
      }
    });

    expect(result.status).toBe("success");
    expect(result.metadata["structuredOutputOk"]).toBe(true);
    expect(result.metadata["structuredOutputAttempts"]).toBe(2);
    expect(result.metadata["failureKind"]).toBeUndefined();
    expect((result.metadata["structuredOutputErrors"] as string[])).toHaveLength(1);
    expect(result.output).toEqual({
      answer:
        "The fix looks partial until packages/core/src/generateId.ts is verified end to end.",
      findings: [
        "packages/core/src/generateId.ts should be checked for initialization-time id generation gaps.",
        "packages/core/src/schemaMinimum.ts should preserve schema-valid id backfilling."
      ],
      referencedFiles: [
        "packages/core/src/generateId.ts",
        "packages/core/src/schemaMinimum.ts"
      ]
    });
  });
});
