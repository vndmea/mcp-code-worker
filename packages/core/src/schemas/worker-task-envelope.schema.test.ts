import { describe, expect, it } from "vitest";

import {
  WorkerResultEnvelopeSchema,
  WorkerTaskEnvelopeSchema
} from "@mcp-code-worker/core";

describe("worker task envelopes", () => {
  it("parses a codex worker task envelope", () => {
    expect(
      WorkerTaskEnvelopeSchema.safeParse({
        id: "task-envelope-1",
        taskType: "review-lite",
        objective: "Review selected files",
        host: "codex",
        model: {
          provider: "openai-compatible",
          model: "deepseek-v4-pro"
        },
        constraints: ["Use selected context only."],
        context: {
          scope: "packages/core"
        },
        outputContract: {
          contractId: "review-worker",
          schemaVersion: "1.0.0"
        },
        trace: {
          createdAt: new Date().toISOString(),
          sourceWorkflow: "host-worker-workflow"
        }
      }).success
    ).toBe(true);
  });

  it("parses controlled worker result states", () => {
    expect(
      WorkerResultEnvelopeSchema.safeParse({
        taskEnvelopeId: "task-envelope-1",
        taskType: "review-lite",
        status: "invalid_output",
        failure: {
          kind: "schema-validation",
          reasons: ["findings must be an array"]
        },
        diagnostics: {
          modelBehaviorProfile: "deepseek-openai-compatible-prompt-json",
          structuredOutputAttempts: 2,
          structuredOutputMode: "prompt-only-json"
        }
      }).success
    ).toBe(true);
  });
});
