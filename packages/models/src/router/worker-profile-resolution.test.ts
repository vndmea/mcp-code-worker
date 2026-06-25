import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentError, createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { resolveWorkerProfile } from "@agent-orchestrator/models";

const createProfile = (overrides: Record<string, unknown> = {}) => ({
  workerId: "mock:worker-model",
  provider: "mock",
  model: "worker-model",
  status: "active",
  supportedTaskTypes: ["summarization"],
  unsupportedTaskTypes: ["codegen"],
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
    requiresLeaderReview: false,
    allowCodegen: false,
    allowPatchGeneration: false,
    allowDomainTasks: false
  },
  evaluatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  suiteName: "default-worker-onboarding-suite",
  suiteVersion: "1",
  ...overrides
});

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-worker-profile-"));

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const aoDir = join(rootDir, ".ao");
  await mkdir(aoDir, { recursive: true });
  await writeFile(
    join(aoDir, "worker-profiles.json"),
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
      context
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
      context
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
      context
    });

    expect(result.source).toBe("incompatible");
    expect(result.freshness.usable).toBe(false);
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
      context
    });

    expect(result.source).toBe("stale");
    expect(result.freshness.usable).toBe(false);
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
        requireProfile: true
      })
    ).rejects.toBeInstanceOf(AgentError);
  });
});
