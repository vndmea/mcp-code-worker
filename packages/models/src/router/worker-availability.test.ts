import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bootstrapSqliteWorkspaceStore,
  createExecutionContextFromEnv,
  openSqliteWorkspaceStore,
  WorkerCapabilityProfileSchema,
  WorkerBenchmarkResultSchema
} from "@mcp-code-worker/core";

import { saveWorkerBenchmark } from "./worker-benchmark-store.js";
import { saveWorkerProfile } from "./worker-profile-store.js";
import { saveWorkerRegistration } from "./worker-registry-store.js";
import { buildWorkerAvailabilitySnapshot } from "./worker-availability.js";

const workerId = "mock:worker-model";

const createProfile = (overrides: Record<string, unknown> = {}) =>
  WorkerCapabilityProfileSchema.parse({
    workerId,
    provider: "mock",
    model: "worker-model",
    status: "qualified",
    supportedTaskTypes: [
      "summarization",
      "doc-generation",
      "review-lite",
      "risk-analysis",
      "code-understanding",
      "codegen",
      "validation-fix",
      "test-generation",
      "log-analysis",
      "json-extraction"
    ],
    unsupportedTaskTypes: [],
    score: {
      instructionFollowing: 0.9,
      structuredOutput: 0.9,
      reasoning: 0.9,
      codeQuality: 0.86,
      domainKnowledge: 0.8,
      reliability: 0.9
    },
    risks: [],
    warnings: [],
    routingPolicy: {
      maxTaskComplexity: "high",
      requiresHostReview: false,
      allowCodegen: true,
      allowPatchGeneration: true,
      allowDomainTasks: true
    },
    evaluatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    suiteName: "default-worker-onboarding-suite",
    suiteVersion: "6",
    admission: {
      passed: true,
      blockingReasons: []
    },
    portrait: {
      scopeDiscipline: 0.9,
      repoGrounding: 0.88,
      answerDirectness: 0.88,
      codeUnderstanding: 0.87,
      fixPlanning: 0.88,
      implementationPlanning: 0.88,
      consistency: 0.9
    },
    taskScores: {
      summarization: 0.88,
      codeUnderstanding: 0.87,
      riskAnalysis: 0.88,
      reviewLite: 0.88,
      codegen: 0.89,
      patchGeneration: 0.9,
      testGeneration: 0.87,
      validationFix: 0.88,
      logAnalysis: 0.88,
      jsonExtraction: 0.88,
      docGeneration: 0.88
    },
    evidence: {
      failedCases: [],
      repoGroundedCases: ["structured-output", "scope-discipline", "review-grounding"],
      fallbackPatternCases: [],
      genericAnswerCases: []
    },
    ...overrides
  });

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-availability-"));

const createBenchmarkResult = () =>
  WorkerBenchmarkResultSchema.parse({
    workerId,
    suiteName: "coding-v1",
    suiteVersion: "2",
    fixtureResults: [
      {
        fixtureId: "type-error-fix",
        title: "Type Error Fix",
        passed: true,
        score: 0.9,
        findings: [],
        rawOutput: {}
      },
      {
        fixtureId: "unit-test-fix",
        title: "Unit Test Fix",
        passed: true,
        score: 0.88,
        findings: [],
        rawOutput: {}
      },
      {
        fixtureId: "scope-control",
        title: "Scope Control",
        passed: true,
        score: 0.93,
        findings: [],
        rawOutput: {}
      },
      {
        fixtureId: "validation-honesty",
        title: "Validation Honesty",
        passed: true,
        score: 0.92,
        findings: [],
        rawOutput: {}
      }
    ],
    evaluationSummary: {
      suiteName: "coding-v1",
      suiteVersion: "2",
      sampleCount: 4,
      passedCount: 4,
      failedCount: 0,
      confidenceBand: "high",
      knownFailureModes: []
    }
  });

describe("buildWorkerAvailabilitySnapshot", () => {
  it.skip("does not report patch-generation as allowed when the persisted profile is internally inconsistent", async () => {
    const rootDir = await createRootDir();
    const writeContext = createExecutionContextFromEnv(undefined, {
      rootDir,
      dryRun: false,
      allowWrite: true,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });
    await bootstrapSqliteWorkspaceStore(writeContext.cwStorageDir);

    await saveWorkerRegistration(
      writeContext,
      {
        workerId,
        provider: "mock",
        model: "worker-model",
        enabled: true,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      true
    );
    await saveWorkerProfile(writeContext, createProfile(), true);
    await saveWorkerBenchmark(writeContext, createBenchmarkResult(), true);

    const snapshot = await buildWorkerAvailabilitySnapshot({
      context: createExecutionContextFromEnv(undefined, {
        rootDir,
        dryRun: true,
        allowWrite: false,
        workerModel: {
          provider: "mock",
          model: "worker-model"
        }
      }),
      workerId
    });

    const db = await openSqliteWorkspaceStore(writeContext.cwStorageDir);
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS count FROM worker_benchmarks WHERE worker_id = ?"
      ).get(workerId) as { count: number };
      expect(row.count).toBe(1);
    } finally {
      db.close();
    }

    expect(snapshot.canRunFormalTasks).toBe(true);
    expect(snapshot.canRunPatchGeneration).toBe(false);
    expect(snapshot.checks.patchGeneration.status).toBe("invalid");
    expect(snapshot.checks.patchGeneration.detail).toContain("inconsistent");
    expect(snapshot.nextSteps.some((step) => step.includes("--update-profile-capabilities"))).toBe(true);
    expect(snapshot.summary).toContain("formal non-patch tasks");
  });
});
