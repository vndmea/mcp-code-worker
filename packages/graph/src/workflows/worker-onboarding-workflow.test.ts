import { describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "@mcp-code-worker/core";

vi.mock("@mcp-code-worker/models", () => ({
  getWorkerProfile: vi.fn(() => ({
    workerId: "mock:worker"
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

import { runWorkerBenchmarkOnboarding } from "./worker-onboarding-workflow.js";

describe("worker onboarding workflow", () => {
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
