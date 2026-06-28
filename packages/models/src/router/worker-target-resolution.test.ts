import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AgentError,
  createExecutionContextFromEnv,
  getCwWorkspaceFilePath
} from "@mcp-code-worker/core";

import {
  requireConfiguredWorkerId,
  resolveWorkerTarget
} from "./worker-target-resolution.js";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-target-"));

const writeRegistry = async (
  rootDir: string,
  workers: Array<Record<string, unknown>>
): Promise<void> => {
  const registryPath = getCwWorkspaceFilePath(rootDir, "workers.json");
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
    workerId: "primary-worker",
    provider: "mock",
    model: "gpt-5.4-mini",
    enabled: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
};

describe("worker target resolution", () => {
  it("resolves a configured default worker id from the registry", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [createRegistration()]);
    const context = createExecutionContextFromEnv(undefined, {
      defaultWorkerId: "primary-worker",
      rootDir,
      workerModel: {
        provider: "mock",
        model: "gpt-5.4-mini"
      }
    });

    const result = await resolveWorkerTarget({ context });

    expect(result.source).toBe("registry");
    expect(result.workerId).toBe("primary-worker");
    expect(result.modelConfig.model).toBe("gpt-5.4-mini");
  });

  it("requires named workers to already exist in the registry", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    await expect(
      resolveWorkerTarget({
        context,
        workerId: "scratch-worker",
        provider: "mock",
        model: "sandbox-worker"
      })
    ).rejects.toThrow("was not found in the worker registry");
  });

  it("requires a named worker when a command depends on persisted worker identity", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    expect(() =>
      requireConfiguredWorkerId(context, undefined, "worker profile lookup")
    ).toThrowError(AgentError);
    expect(() =>
      requireConfiguredWorkerId(context, undefined, "worker profile lookup")
    ).toThrow("defaultWorkerId");
  });
});
