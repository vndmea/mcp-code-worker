import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  listAuditEvents,
  type WorkerRegistration
} from "@mcp-code-worker/core";
import {
  getWorkerRegistryPath,
  readWorkerRegistry,
  removeWorkerRegistration,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-registry-"));

const createRegistration = (
  overrides: Partial<WorkerRegistration> = {}
): WorkerRegistration => {
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

const writeRegistry = async (rootDir: string, value: unknown): Promise<void> => {
  const registryPath = getWorkerRegistryPath(rootDir);
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(registryPath, JSON.stringify(value, null, 2), "utf8");
};

describe("worker registry store", () => {
  it("returns an empty result when the registry is missing", async () => {
    const rootDir = await createRootDir();
    const result = await readWorkerRegistry(rootDir);

    expect(result.exists).toBe(false);
    expect(result.workers).toEqual([]);
  });

  it("reports invalid JSON and invalid schema", async () => {
    const rootDir = await createRootDir();
    const registryPath = getWorkerRegistryPath(rootDir);
    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, "{", "utf8");

    expect((await readWorkerRegistry(rootDir)).error).toBeDefined();

    await writeRegistry(rootDir, { version: 2, workers: [] });
    expect((await readWorkerRegistry(rootDir)).error).toBeDefined();
  });

  it("saves and merges registrations only when writes are allowed", async () => {
    const rootDir = await createRootDir();
    const dryRunContext = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const dryRun = await saveWorkerRegistration(
      dryRunContext,
      createRegistration()
    );

    expect(dryRun.mode).toBe("dry-run");
    expect((await readWorkerRegistry(rootDir)).exists).toBe(false);

    const executeContext = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });
    await saveWorkerRegistration(executeContext, createRegistration(), true);
    await saveWorkerRegistration(
      executeContext,
      createRegistration({
        workerId: "mock:second-worker",
        model: "second-worker"
      }),
      true
    );
    const result = await readWorkerRegistry(rootDir);
    const contents = await readFile(getWorkerRegistryPath(rootDir), "utf8");

    expect(result.workers).toHaveLength(2);
    expect(contents).not.toContain("apiKey");
    expect(
      (await listAuditEvents(rootDir, 10)).some(
        (event) => event.action === "save-worker-registration"
      )
    ).toBe(true);
  });

  it("blocks reusing one worker id for a different provider/model target", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });
    await saveWorkerRegistration(
      context,
      createRegistration({
        workerId: "primary-worker"
      }),
      true
    );

    await expect(
      saveWorkerRegistration(
        context,
        createRegistration({
          workerId: "primary-worker",
          provider: "openai-compatible",
          model: "deepseek-v4-flash"
        }),
        true
      )
    ).rejects.toThrow("already bound");
  });

  it("removes registrations only when writes are allowed", async () => {
    const rootDir = await createRootDir();
    const executeContext = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });
    await saveWorkerRegistration(executeContext, createRegistration(), true);

    const dryRunContext = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });
    const dryRun = await removeWorkerRegistration(
      dryRunContext,
      "mock:registered-worker"
    );

    expect(dryRun.removed).toBe(false);
    expect((await readWorkerRegistry(rootDir)).workers).toHaveLength(1);

    const removed = await removeWorkerRegistration(
      executeContext,
      "mock:registered-worker",
      true
    );

    expect(removed.removed).toBe(true);
    expect((await readWorkerRegistry(rootDir)).workers).toHaveLength(0);
  });
});
