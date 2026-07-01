import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AgentError,
  createExecutionContextFromEnv,
  getCwConfigPath,
  normalizeCommandInput
} from "@mcp-code-worker/core";
import { saveWorkerRegistration } from "@mcp-code-worker/models";

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
  const context = createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: true,
    dryRun: false
  });

  for (const worker of workers) {
    await saveWorkerRegistration(context, worker as ReturnType<typeof createRegistration>, true);
  }
};

const writeConfig = async (
  rootDir: string,
  value: Record<string, unknown>
): Promise<void> => {
  const configPath = getCwConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 2,
        ...value
      },
      null,
      2
    ),
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
  it("resolves an explicit worker id from the registry", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [createRegistration()]);
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "gpt-5.4-mini"
      }
    });

    const result = await resolveWorkerTarget({
      context,
      workerId: "primary-worker"
    });

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
    ).toThrow("--worker <id>");
  });

  it("uses the per-worker client command persisted in config.json", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(
      rootDir,
      [
        createRegistration({
          workerId: "opencode-local",
          provider: "opencode",
          model: "deepseek/deepseek-v4-flash"
        })
      ]
    );
    await writeConfig(rootDir, {
      workers: [
        {
          workerId: "opencode-local",
          provider: "opencode",
          model: "deepseek/deepseek-v4-flash",
          enabled: true,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          clientCommand: "C:/tools/opencode.exe"
        }
      ]
    });
    const context = createExecutionContextFromEnv(undefined, {
      rootDir,
      workerModel: {
        provider: "mock",
        model: "gpt-5.4-mini"
      }
    });

    const result = await resolveWorkerTarget({
      context,
      workerId: "opencode-local"
    });

    expect(result.modelConfig.clientCommand).toBe(
      normalizeCommandInput("C:/tools/opencode.exe")
    );
  });
});
