import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentError, createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  getWorkerRegistryPath,
  resolveWorkerModel
} from "@agent-orchestrator/models";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-worker-model-resolution-"));

const writeRegistry = async (
  rootDir: string,
  workers: Array<Record<string, unknown>>
): Promise<void> => {
  const registryPath = getWorkerRegistryPath(rootDir);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({ version: 1, workers }, null, 2),
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

describe("resolveWorkerModel", () => {
  it("returns registry-derived config for registered workers", async () => {
    const rootDir = await createRootDir();
    process.env.WORKER_MODEL_API_KEY = "secret-value";
    await writeRegistry(rootDir, [createRegistration()]);
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    const result = await resolveWorkerModel({
      context,
      workerId: "mock:registered-worker"
    });

    expect(result.source).toBe("registry");
    expect(result.modelConfig.model).toBe("registered-worker");
    expect(result.modelConfig.apiKey).toBe("secret-value");
    expect(result.warnings.join("\n")).not.toContain("secret-value");

    delete process.env.WORKER_MODEL_API_KEY;
  });

  it("fails for disabled and unknown explicit workers", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [
      createRegistration({
        enabled: false
      })
    ]);
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    await expect(
      resolveWorkerModel({ context, workerId: "mock:registered-worker" })
    ).rejects.toBeInstanceOf(AgentError);
    await expect(
      resolveWorkerModel({ context, workerId: "mock:unknown" })
    ).rejects.toThrow("not registered");
  });

  it("falls back to the environment default without an explicit worker", async () => {
    const rootDir = await createRootDir();
    process.env.WORKER_MODEL_API_KEY = "env-secret";
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "openai-compatible",
        model: "env-worker"
      }
    });

    const result = await resolveWorkerModel({ context });

    expect(result.source).toBe("env-default");
    expect(result.workerId).toBe("openai-compatible:env-worker");

    delete process.env.WORKER_MODEL_API_KEY;
  });

  it("fails early with a unified worker api key error", async () => {
    const rootDir = await createRootDir();
    delete process.env.WORKER_MODEL_API_KEY;
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "openai-compatible",
        model: "deepseek-v4-pro"
      }
    });

    await expect(resolveWorkerModel({ context })).rejects.toMatchObject({
      code: "WORKER_MODEL_API_KEY_MISSING"
    });
  });
});
