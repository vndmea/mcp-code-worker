import { describe, expect, it, vi } from "vitest";

import type { ExecutionContext } from "@mcp-code-worker/core";

vi.mock("@mcp-code-worker/models", () => ({
  getWorkerProfile: vi.fn(() => ({
    workerId: "mock:worker"
  })),
  inspectConfiguredLocalClientCommand: vi.fn(() => ({
    command: "node",
    compatibility: {
      checked: false,
      message: "Command resolution passed.",
      status: "pass"
    },
    configuredCommand: "node",
    isPathLike: false,
    resolvedPath: "C:/Program Files/nodejs/node.exe",
    source: "configured",
    status: "pass"
  })),
  requireConfiguredWorkerId: vi.fn(
    (context: ExecutionContext, workerId: string | undefined, action: string) => {
      void context;
      void action;

      if (!workerId) {
        throw new Error("workerId is required in this test mock");
      }

      return workerId;
    }
  ),
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
      clientCommand: "node",
      model: "worker-model",
      provider: "client"
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

import {
  getWorkerProfile,
  resolveWorkerProfile,
  saveWorkerProfile
} from "@mcp-code-worker/models";

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
  runWorkerInterviewWorkflow: vi.fn(() => ({
    workerId: "mock:worker",
    profile: {
      workerId: "mock:worker",
      provider: "client",
      model: "worker-model",
      status: "qualified",
      supportedTaskTypes: [],
      unsupportedTaskTypes: [],
      score: {
        instructionFollowing: 1,
        structuredOutput: 1,
        reasoning: 1,
        codeQuality: 1,
        domainKnowledge: 1,
        reliability: 1
      },
      risks: [],
      warnings: [],
      routingPolicy: {
        maxTaskComplexity: "medium",
        requiresHostReview: false,
        allowCodegen: true,
        allowPatchGeneration: false,
        allowDomainTasks: true
      },
      evaluatedAt: new Date().toISOString(),
      evaluationSummary: {
        suiteName: "default-worker-onboarding-suite",
        suiteVersion: "6",
        sampleCount: 9,
        passedCount: 9,
        failedCount: 0,
        confidenceBand: "high",
        knownFailureModes: []
      }
    },
    status: "qualified",
    taskResults: [],
    warnings: [],
    interviewDiagnostics: {
      outcome: "completed",
      providerInvocationFailures: 0,
      failedTaskCount: 0,
      recommendedActions: []
    },
    persistenceAdvice: {
      canPersist: true,
      reason: "ok",
      recommendedActions: []
    },
    suite: {
      name: "default-worker-onboarding-suite",
      tasks: []
    }
  }))
}));

import { runWorkerBenchmarkWorkflow } from "./worker-benchmark-workflow.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";
import {
  resolveWorkerCapabilityProfileForExecution,
  runWorkerInterviewOnboarding,
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

  it("surfaces resolved local client details for worker interview onboarding", async () => {
    const result = await runWorkerInterviewOnboarding({
      context: {
        cwStorageDir: "/tmp/cw",
        rootDir: "/tmp/repo"
      } as ExecutionContext,
      persistProfile: false,
      workerId: "mock:worker"
    });

    expect(result.localClientRuntime).toEqual({
      configuredCommand: "node",
      resolvedCommand: "C:/Program Files/nodejs/node.exe",
      resolvedPath: "C:/Program Files/nodejs/node.exe",
      source: "configured"
    });
  });

  it("preserves benchmark-derived patch capability when interview results are re-saved", async () => {
    vi.mocked(getWorkerProfile).mockResolvedValueOnce({
      workerId: "mock:worker",
      provider: "client",
      model: "worker-model",
      status: "qualified",
      supportedTaskTypes: ["summarization", "patch-generation"],
      unsupportedTaskTypes: [],
      score: {
        instructionFollowing: 1,
        structuredOutput: 1,
        reasoning: 1,
        codeQuality: 1,
        domainKnowledge: 1,
        reliability: 1
      },
      risks: [],
      warnings: [],
      routingPolicy: {
        maxTaskComplexity: "medium",
        requiresHostReview: false,
        allowCodegen: true,
        allowPatchGeneration: true,
        allowDomainTasks: true
      },
      evaluatedAt: new Date().toISOString(),
      evaluationSummary: {
        suiteName: "default-worker-onboarding-suite",
        suiteVersion: "6",
        sampleCount: 9,
        passedCount: 9,
        failedCount: 0,
        confidenceBand: "high",
        knownFailureModes: []
      }
    });

    const result = await runWorkerInterviewOnboarding({
      context: {
        cwStorageDir: "/tmp/cw",
        rootDir: "/tmp/repo"
      } as ExecutionContext,
      persistProfile: true,
      workerId: "mock:worker"
    });

    expect(result.profile.routingPolicy.allowPatchGeneration).toBe(true);
    expect(result.profile.supportedTaskTypes).toContain("patch-generation");
    expect(result.profile.unsupportedTaskTypes).not.toContain("patch-generation");
    expect(result.profile.evaluationSummary?.suiteName).toBe(
      "default-worker-onboarding-suite"
    );
    expect(result.warnings.join("\n")).toContain(
      "Preserved benchmark-derived patch-generation capability"
    );
    expect(vi.mocked(saveWorkerProfile).mock.calls.at(-1)?.[1]).toMatchObject({
      workerId: "mock:worker",
      routingPolicy: {
        allowPatchGeneration: true
      }
    });
  });

  it("surfaces resolved local client details for worker benchmark onboarding", async () => {
    vi.mocked(runWorkerBenchmarkWorkflow).mockResolvedValueOnce({
      suiteName: "coding-v1",
      suiteVersion: "2",
      workerId: "mock:worker",
      fixtureResults: [],
      evaluationSummary: {
        suiteName: "coding-v1",
        suiteVersion: "2",
        sampleCount: 0,
        passedCount: 0,
        failedCount: 0,
        confidenceBand: "low",
        knownFailureModes: []
      }
    });

    const result = await runWorkerBenchmarkOnboarding({
      context: {
        cwStorageDir: "/tmp/cw",
        rootDir: "/tmp/repo"
      } as ExecutionContext,
      persistArtifact: false,
      updateProfileCapabilities: false,
      workerId: "mock:worker"
    });

    expect(result.localClientRuntime).toEqual({
      configuredCommand: "node",
      resolvedCommand: "C:/Program Files/nodejs/node.exe",
      resolvedPath: "C:/Program Files/nodejs/node.exe",
      source: "configured"
    });
  });
});
