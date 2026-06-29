import { describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "@mcp-code-worker/core";

vi.mock("@mcp-code-worker/models", () => ({
  getWorkerProfile: vi.fn(() => ({
    workerId: "mock:worker"
  })),
  resolveWorkerProfile: vi.fn(() => ({
    workerId: "mock:worker",
    source: "persisted",
    profile: null,
    freshness: {
      usable: false,
      reason: "mock profile resolution",
      shouldReinterview: true
    }
  })),
  resolveWorkerTarget: vi.fn(() => ({
    modelConfig: {
      model: "worker-model",
      provider: "mock"
    },
    source: "registry",
    warnings: [],
    workerId: "mock:worker"
  })),
  saveWorkerProfile: vi.fn(() => ({
    mode: "execute",
    path: "/tmp/worker-profile.json"
  }))
}));

import { resolveWorkerProfile } from "@mcp-code-worker/models";

vi.mock("./worker-benchmark-workflow.js", () => ({
  applyBenchmarkCapabilityUpdate: vi.fn(() => ({
    capabilityUpdateApplied: true,
    patchGenerationQualified: true,
    profile: {
      workerId: "mock:worker"
    }
  })),
  runWorkerBenchmarkWorkflow: vi.fn(),
  saveWorkerBenchmarkArtifact: vi.fn(() => ({
    mode: "execute",
    path: "/tmp/benchmark.json"
  }))
}));

vi.mock("./worker-interview-workflow.js", () => ({
  runWorkerInterviewWorkflow: vi.fn()
}));

import { runWorkerBenchmarkWorkflow } from "./worker-benchmark-workflow.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";
import {
  resolveWorkerCapabilityProfileForExecution,
  runWorkerBenchmarkOnboarding
} from "./worker-onboarding-workflow.js";

describe("worker onboarding workflow", () => {
  it("blocks execution with a placeholder profile instead of rerunning interviews", async () => {
    vi.mocked(resolveWorkerProfile).mockResolvedValueOnce({
      workerId: "mock:worker",
      source: "missing",
      profile: null,
      freshness: {
        usable: false,
        reason: "No persisted worker profile found for mock:worker.",
        shouldReinterview: true
      }
    });

    const result = await resolveWorkerCapabilityProfileForExecution({
      workerContext: {
        workerModel: {
          provider: "mock",
          model: "worker-model"
        }
      } as ExecutionContext,
      workerId: "mock:worker"
    });

    expect(runWorkerInterviewWorkflow).not.toHaveBeenCalled();
    expect(result.profile.status).toBe("not-qualified");
    expect(result.profile.supportedTaskTypes).toEqual([]);
    expect(result.warnings.join("\n")).toContain(
      "No persisted worker profile found for mock:worker."
    );
    expect(result.warnings.join("\n")).toContain(
      "cw worker interview --worker mock:worker --save"
    );
  });

  it("reuses a provided benchmark result instead of rerunning the workflow", async () => {
    const benchmarkResult = {
      suiteName: "coding-v1",
      workerId: "mock:worker"
    } as Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;

    const result = await runWorkerBenchmarkOnboarding({
      benchmarkResult,
      context: {
        cwStorageDir: "/tmp/cw",
        rootDir: "/tmp/repo"
      } as ExecutionContext,
      persistArtifact: true,
      updateProfileCapabilities: true,
      workerId: "mock:worker"
    });

    expect(runWorkerBenchmarkWorkflow).not.toHaveBeenCalled();
    expect(result.benchmarkResult).toBe(benchmarkResult);
    expect(result.profileUpdate?.capabilityUpdateApplied).toBe(true);
  });
});
