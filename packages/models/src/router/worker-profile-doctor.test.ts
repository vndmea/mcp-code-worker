import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExecutionContextFromEnv } from "@mcp-code-worker/core";
import {
  createWorkerProfileDoctorChecks,
  getWorkerRegistryPath,
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-doctor-"));

const writeRegistry = async (rootDir: string, value: unknown): Promise<void> => {
  const registryPath = getWorkerRegistryPath(rootDir);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    "utf8"
  );
};

const writeProfiles = async (rootDir: string, value: unknown): Promise<void> => {
  const profiles = Array.isArray(value) ? value : [];
  const context = createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: true,
    dryRun: false
  });

  for (const profile of profiles) {
    await saveWorkerProfile(context, profile as Parameters<typeof saveWorkerProfile>[1], true);
  }
};

const writeRegistrations = async (
  rootDir: string,
  workers: Array<Record<string, unknown>>
): Promise<void> => {
  const context = createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: true,
    dryRun: false
  });

  for (const worker of workers) {
    await saveWorkerRegistration(
      context,
      worker as Parameters<typeof saveWorkerRegistration>[1],
      true
    );
  }
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

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    await writeRegistrations(rootDir, [createRegistration()]);
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
      workers: [
        {
          workerId: "broken-worker"
        }
      ]
    });
    const context = createExecutionContextFromEnv(undefined, { rootDir });
    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) => check.name === "worker-registry" && check.status === "fail"
      )
    ).toBe(true);
  });

  it("flags provider-error style profiles for re-interview", async () => {
    const rootDir = await createRootDir();
    await writeRegistrations(rootDir, [createRegistration()]);
    await writeProfiles(rootDir, [
      {
        workerId: "mock:registered-worker",
        provider: "mock",
        model: "registered-worker",
        status: "not-qualified",
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
          requiresHostReview: true,
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

  it("warns when an opencode registration disagrees with the local opencode default model", async () => {
    const rootDir = await createRootDir();
    const configHome = await mkdtemp(join(tmpdir(), "cw-opencode-config-"));
    const opencodeConfigPath = join(configHome, "opencode", "opencode.json");
    await mkdir(dirname(opencodeConfigPath), { recursive: true });
    await writeFile(
      opencodeConfigPath,
      JSON.stringify(
        {
          model: "deepseek/deepseek-v4-flash"
        },
        null,
        2
      ),
      "utf8"
    );
    vi.stubEnv("XDG_CONFIG_HOME", configHome);

    await writeRegistrations(rootDir, [
      createRegistration({
        workerId: "opencode-local",
        provider: "opencode",
        model: "sudocode/gpt-5.4"
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "opencode",
        model: "sudocode/gpt-5.4"
      }
    });

    const checks = await createWorkerProfileDoctorChecks(context);

    expect(
      checks.some(
        (check) =>
          check.name === "registered-worker-profile" &&
          check.metadata?.source === "opencode-model-mismatch" &&
          check.metadata?.registeredModel === "sudocode/gpt-5.4" &&
          check.metadata?.localOpencodeDefaultModel ===
            "deepseek/deepseek-v4-flash"
      )
    ).toBe(true);
  });
});
