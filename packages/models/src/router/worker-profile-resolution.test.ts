import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AgentError,
  createExecutionContextFromEnv,
  getCwWorkspaceFilePath
} from "@mcp-code-worker/core";
import { resolveWorkerProfile } from "@mcp-code-worker/models";

const createProfile = (overrides: Record<string, unknown> = {}) => ({
  workerId: "mock:worker-model",
  provider: "mock",
  model: "worker-model",
  status: "qualified",
  supportedTaskTypes: ["summarization", "doc-generation"],
  unsupportedTaskTypes: ["codegen", "validation-fix"],
  score: {
    instructionFollowing: 0.9,
    structuredOutput: 0.9,
    reasoning: 0.9,
    codeQuality: 0.2,
    domainKnowledge: 0.7,
    reliability: 0.9
  },
  risks: [],
  warnings: [],
  routingPolicy: {
    maxTaskComplexity: "low",
    requiresHostReview: false,
    allowCodegen: false,
    allowPatchGeneration: false,
    allowDomainTasks: false
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
    scopeDiscipline: 0.82,
    repoGrounding: 0.8,
    answerDirectness: 0.8,
    codeUnderstanding: 0.76,
    fixPlanning: 0.75,
    implementationPlanning: 0.62,
    consistency: 0.84
  },
  taskScores: {
    summarization: 0.79,
    codeUnderstanding: 0.76,
    riskAnalysis: 0.74,
    reviewLite: 0.78,
    codegen: 0.42,
    patchGeneration: 0.39,
    testGeneration: 0.44,
    validationFix: 0.41,
    logAnalysis: 0.78,
    jsonExtraction: 0.77,
    docGeneration: 0.79
  },
  evidence: {
    failedCases: [],
    repoGroundedCases: ["structured-output", "scope-discipline", "summarization"],
    fallbackPatternCases: [],
    genericAnswerCases: []
  },
  ...overrides
});

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-profile-"));

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const profilePath = getCwWorkspaceFilePath(rootDir, "worker-profiles.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify(profiles, null, 2),
    "utf8"
  );
};

describe("resolveWorkerProfile", () => {
  it("resolves an existing persisted worker profile", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [createProfile()]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    const result = await resolveWorkerProfile({
      context,
      workerId: "mock:worker-model"
    });

    expect(result.source).toBe("persisted");
    expect(result.profile?.workerId).toBe("mock:worker-model");
    expect(result.freshness.usable).toBe(true);
  });

  it("returns missing when no persisted profile exists", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    const result = await resolveWorkerProfile({
      context,
      workerId: "mock:worker-model"
    });

    expect(result.source).toBe("missing");
    expect(result.profile).toBeNull();
    expect(result.freshness.usable).toBe(false);
  });

  it("returns incompatible on provider or model mismatch", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [
      createProfile({
        provider: "mock",
        model: "different-model"
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    const result = await resolveWorkerProfile({
      context,
      workerId: "mock:worker-model"
    });

    expect(result.source).toBe("incompatible");
    expect(result.freshness.usable).toBe(false);
  });

  it("checks compatibility against an effective registered model config", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [
      createProfile({
        workerId: "mock:registered-worker",
        provider: "mock",
        model: "registered-worker"
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "env-worker"
      }
    });

    const compatible = await resolveWorkerProfile({
      context,
      workerId: "mock:registered-worker",
      modelConfig: {
        provider: "mock",
        model: "registered-worker"
      }
    });
    const incompatible = await resolveWorkerProfile({
      context,
      workerId: "mock:registered-worker",
      modelConfig: {
        provider: "mock",
        model: "different-worker"
      }
    });

    expect(compatible.freshness.usable).toBe(true);
    expect(incompatible.source).toBe("incompatible");
  });

  it("returns stale when the persisted profile is expired", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [
      createProfile({
        expiresAt: new Date(Date.now() - 86_400_000).toISOString()
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    const result = await resolveWorkerProfile({
      context,
      workerId: "mock:worker-model"
    });

    expect(result.source).toBe("stale");
    expect(result.freshness.usable).toBe(false);
  });

  it("treats provider-failure profiles as needing re-interview", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [
      createProfile({
        status: "not-qualified",
        supportedTaskTypes: [],
        unsupportedTaskTypes: ["summarization", "codegen"],
        warnings: [
          "summarization: Attempt 1: provider invocation failed: connection refused"
        ]
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    const result = await resolveWorkerProfile({
      context,
      workerId: "mock:worker-model"
    });

    expect(result.source).toBe("provider-error");
    expect(result.freshness.usable).toBe(false);
    expect(result.freshness.reason).toContain("completed interview");
  });

  it("throws when requireProfile is true and no usable profile exists", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "worker-model"
      }
    });

    await expect(
      resolveWorkerProfile({
        context,
        workerId: "mock:worker-model",
        requireProfile: true
      })
    ).rejects.toBeInstanceOf(AgentError);
  });
});

