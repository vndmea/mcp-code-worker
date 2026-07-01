import { describe, expect, it } from "vitest";

import {
  WorkerResultEnvelopeSchema,
  WorkerTaskExecutionRecordSchema,
  WorkerTaskEnvelopeSchema
} from "@mcp-code-worker/core";
import { WorkerTrustProfileSchema } from "./worker-capability.schema.js";

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

  it("parses worker trust profiles and execution records", () => {
    const createdAt = new Date().toISOString();
    const taskEnvelope = {
      id: "task-envelope-1",
      taskType: "review-lite",
      objective: "Review selected files",
      host: "codex",
      model: {
        provider: "mock",
        model: "worker-model"
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
        createdAt,
        sourceWorkflow: "host-worker-workflow"
      }
    };
    const workerTrustProfile = {
      workerId: "mock:worker-model",
      trustLevel: "benchmarked",
      onboardingStatus: "passed",
      interviewStatus: "passed",
      benchmarkStatus: "passed",
      recommendedMode: "dry-run",
      warnings: []
    };

    expect(WorkerTrustProfileSchema.safeParse(workerTrustProfile).success).toBe(true);
    expect(
      WorkerTaskExecutionRecordSchema.safeParse({
        id: "worker-exec-1",
        taskEnvelope,
        resultEnvelope: {
          taskEnvelopeId: "task-envelope-1",
          taskType: "review-lite",
          status: "ok",
          diagnostics: {
            modelBehaviorProfile: "mock-default",
            structuredOutputAttempts: 1,
            structuredOutputMode: "native-json-schema"
          }
        },
        workerId: "mock:worker-model",
        workerTrustProfile,
        status: "ok",
        artifactRefs: ["worker-debug.json"],
        createdAt
      }).success
    ).toBe(true);
  });
});
