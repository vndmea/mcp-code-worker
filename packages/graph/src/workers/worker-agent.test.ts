import { describe, expect, it } from "vitest";

import type { ModelConfig } from "@agent-orchestrator/core";
import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
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

  public async invoke(
    _config: ModelConfig,
    _request: ModelInvocationRequest
  ): Promise<ModelInvocationResult> {
    return this.responses.shift() ?? {
      provider: "sequence",
      model: "test-model",
      text: "{}"
    };
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
        assignedRole: "leader",
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
        assignedRole: "leader",
        priority: "high",
        constraints: [],
        metadata: {}
      }
    });

    expect(result.status).toBe("needs_review");
    expect(result.output).toEqual({
      suggestedTests: [
        "Validate schema parsing for structured workflow outputs.",
        "Validate state transitions for planning and leader-worker workflows.",
        "Validate write and shell safety policies."
      ]
    });
    expect(result.risks.some((risk) => risk.includes("schema validation failed"))).toBe(true);
  });
});
