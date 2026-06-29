import { describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "@mcp-code-worker/core";

vi.mock("@mcp-code-worker/graph", () => ({
  applyBenchmarkCapabilityUpdate: vi.fn(() => ({
    capabilityUpdateApplied: true,
    patchGenerationQualified: true,
    profile: {
      workerId: "mock:worker"
    }
  })),
  runWorkerBenchmarkWorkflow: vi.fn(),
  saveWorkerBenchmarkArtifact: vi.fn(async () => ({
    mode: "execute",
    path: "/tmp/benchmark.json"
  }))
}));

vi.mock("@mcp-code-worker/models", () => ({
  getWorkerProfile: vi.fn(async () => ({
    workerId: "mock:worker"
  })),
  saveWorkerProfile: vi.fn(async () => ({
    mode: "execute",
    path: "/tmp/worker-profile.json"
  }))
}));

import { runWorkerBenchmarkWorkflow } from "@mcp-code-worker/graph";

import { runBenchmarkCapabilityUpdate } from "./worker-onboarding.js";

describe("worker onboarding benchmark updates", () => {
  it("reuses a provided benchmark result instead of rerunning the workflow", async () => {
    const benchmarkResult = {
      suiteName: "coding-v1",
      workerId: "mock:worker"
    } as Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;

    const result = await runBenchmarkCapabilityUpdate({
      benchmarkResult,
      context: {
        cwStorageDir: "/tmp/cw",
        rootDir: "/tmp/repo"
      } as ExecutionContext,
      modelConfig: {
        model: "worker-model",
        provider: "mock"
      } as never,
      save: true,
      updateProfileCapabilities: true,
      workerId: "mock:worker"
    });

    expect(runWorkerBenchmarkWorkflow).not.toHaveBeenCalled();
    expect(result.benchmarkResult).toBe(benchmarkResult);
    expect(result.profileUpdate?.capabilityUpdateApplied).toBe(true);
  });
});
