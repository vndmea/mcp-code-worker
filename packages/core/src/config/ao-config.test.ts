import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getAoConfigPath,
  loadAoConfig,
  resolveExecutionContext
} from "@agent-orchestrator/core";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-config-"));

const writeConfig = async (rootDir: string, value: unknown): Promise<void> => {
  const configPath = getAoConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(value, null, 2), "utf8");
};

describe("ao config", () => {
  it("loads defaults when config is missing", async () => {
    const rootDir = await createWorkspace();
    const result = await loadAoConfig(rootDir);

    expect(result.exists).toBe(false);
    expect(result.config.version).toBe(1);
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("loads valid config and resolves fixed model api key env vars", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      workerModel: {
        provider: "litellm",
        model: "qwen3-coder-mini"
      },
      safety: {
        dryRun: false,
        allowWrite: true,
        allowedCommands: ["git", "pnpm"]
      }
    });

    const result = await loadAoConfig(rootDir);
    const context = await resolveExecutionContext({
      rootDir,
      env: {
        WORKER_MODEL_API_KEY: "worker-secret"
      }
    });

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
    expect(context.workerModel.provider).toBe("litellm");
    expect(context.workerModel.apiKey).toBe("worker-secret");
    expect(context.allowWrite).toBe(true);
    expect(context.dryRun).toBe(false);
    expect(context.contextBudget.maxFileBytes).toBe(20_000);
  });

  it("returns clear errors for invalid config and falls back to defaults", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      workerModel: {
        provider: "litellm",
        model: "qwen3-coder",
        baseURL: "not-a-url"
      }
    });

    const result = await loadAoConfig(rootDir);

    expect(result.exists).toBe(true);
    expect(result.error).toContain("baseURL");
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("applies precedence cli overrides > env > config > defaults", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      workerModel: {
        provider: "litellm",
        model: "config-worker"
      },
      safety: {
        dryRun: false,
        allowWrite: false,
        allowedCommands: ["git"]
      }
    });

    const context = await resolveExecutionContext({
      rootDir,
      env: {
        WORKER_MODEL_PROVIDER: "env-provider",
        WORKER_MODEL_NAME: "env-worker",
        AO_DRY_RUN: "true"
      },
      cliOverrides: {
        allowWrite: true,
        workerModel: {
          provider: "cli-provider",
          model: "cli-worker"
        }
      }
    });

    expect(context.workerModel.provider).toBe("cli-provider");
    expect(context.workerModel.model).toBe("cli-worker");
    expect(context.dryRun).toBe(true);
    expect(context.allowWrite).toBe(true);
    expect(context.allowedCommands).toEqual(["git"]);
  });

  it("uses AO_ROOT_DIR when rootDir is not passed explicitly", async () => {
    const rootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      env: {
        AO_ROOT_DIR: rootDir
      }
    });

    expect(context.rootDir).toBe(rootDir);
  });

  it("prefers explicit rootDir over AO_ROOT_DIR", async () => {
    const rootDir = await createWorkspace();
    const envRootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      rootDir,
      env: {
        AO_ROOT_DIR: envRootDir
      }
    });

    expect(context.rootDir).toBe(rootDir);
  });

  it("resolves context budget from config", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      context: {
        maxFileBytes: 128,
        maxTotalBytes: 512,
        ignoredPaths: ["generated", "tmp/cache"]
      }
    });

    const context = await resolveExecutionContext({ rootDir });

    expect(context.contextBudget.maxFileBytes).toBe(128);
    expect(context.contextBudget.maxTotalBytes).toBe(512);
    expect(context.contextBudget.ignoredPaths).toEqual(["generated", "tmp/cache"]);
  });
});
