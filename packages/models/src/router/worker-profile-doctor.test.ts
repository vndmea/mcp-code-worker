import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  createWorkerProfileDoctorChecks,
  getWorkerProfileStorePath,
  getWorkerRegistryPath
} from "@agent-orchestrator/models";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-worker-doctor-"));

const writeRegistry = async (rootDir: string, value: unknown): Promise<void> => {
  await mkdir(join(rootDir, ".ao"), { recursive: true });
  await writeFile(
    getWorkerRegistryPath(rootDir),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8"
  );
};

const writeProfiles = async (rootDir: string, value: unknown): Promise<void> => {
  await mkdir(join(rootDir, ".ao"), { recursive: true });
  await writeFile(
    getWorkerProfileStorePath(rootDir),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8"
  );
};

const createRegistration = (overrides: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();

  return {
    workerId: "mock:registered-worker",
    provider: "mock",
    model: "registered-worker",
    enabled: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
};

describe("worker profile doctor checks", () => {
  it("warns when the worker registry is missing", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, { rootDir });
    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) => check.name === "worker-registry" && check.status === "warning"
      )
    ).toBe(true);
  });

  it("reports registry count and missing registered profiles", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, {
      version: 1,
      workers: [createRegistration()]
    });
    const context = createExecutionContextFromEnv(undefined, { rootDir });
    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) =>
          check.name === "worker-registry" &&
          check.status === "pass" &&
          check.metadata?.workerCount === 1
      )
    ).toBe(true);
    expect(
      checks.some(
        (check) =>
          check.name === "registered-worker-profile" &&
          check.status === "warning"
      )
    ).toBe(true);
  });

  it("fails for invalid worker registry schema", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, {
      version: 2,
      workers: []
    });
    const context = createExecutionContextFromEnv(undefined, { rootDir });
    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) => check.name === "worker-registry" && check.status === "fail"
      )
    ).toBe(true);
  });

  it("flags provider-error style blocked profiles for re-interview", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, {
      version: 1,
      workers: [createRegistration()]
    });
    await writeProfiles(rootDir, [
      {
        workerId: "mock:registered-worker",
        provider: "mock",
        model: "registered-worker",
        status: "blocked",
        supportedTaskTypes: [],
        unsupportedTaskTypes: ["summarization"],
        score: {
          instructionFollowing: 0,
          structuredOutput: 0,
          reasoning: 0,
          codeQuality: 0,
          domainKnowledge: 0,
          reliability: 0
        },
        risks: [
          "summarization: Attempt 1: provider invocation failed: connection refused"
        ],
        warnings: [
          "summarization: Attempt 1: provider invocation failed: connection refused"
        ],
        routingPolicy: {
          maxTaskComplexity: "low",
          requiresLeaderReview: true,
          allowCodegen: false,
          allowPatchGeneration: false,
          allowDomainTasks: false
        },
        evaluatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        suiteName: "default-worker-onboarding-suite",
        suiteVersion: "1"
      }
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "registered-worker"
      }
    });
    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) =>
          check.name === "registered-worker-profile" &&
          check.metadata?.source === "provider-error" &&
          check.metadata?.shouldReinterview === true
      )
    ).toBe(true);
  });
});
