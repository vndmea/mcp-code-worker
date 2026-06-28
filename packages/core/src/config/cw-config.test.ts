import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCwConfigPath,
  loadCwConfig,
  resolveExecutionContext
} from "@mcp-code-worker/core";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-config-"));

const writeConfig = async (rootDir: string, value: unknown): Promise<void> => {
  const configPath = getCwConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(value, null, 2), "utf8");
};

describe("cw config", () => {
  it("loads defaults when config is missing", async () => {
    const rootDir = await createWorkspace();
    const result = await loadCwConfig(rootDir);

    expect(result.exists).toBe(false);
    expect(result.config.version).toBe(1);
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("loads valid config and resolves persisted model api keys", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      workerClientCommand: "custom-client",
      workerModel: {
        provider: "litellm",
        model: "qwen3-coder-mini",
        apiKey: "persisted-secret"
      },
      safety: {
        dryRun: false,
        allowWrite: true,
        allowedCommands: ["git", "pnpm"]
      }
    });

    const result = await loadCwConfig(rootDir);
    const context = await resolveExecutionContext({ rootDir });

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
    expect(context.workerModel.provider).toBe("litellm");
    expect(context.workerModel.apiKey).toBe("persisted-secret");
    expect(context.workerModel.clientCommand).toBe("custom-client");
    expect(context.allowWrite).toBe(true);
    expect(context.dryRun).toBe(false);
    expect(context.contextBudget.strictFiles).toBe(false);
  });

  it("loads persisted config through canonical workspace path aliases", async () => {
    const rootDir = await createWorkspace();
    const linkRootDir = await mkdtemp(join(tmpdir(), "cw-config-link-"));
    const aliasRootDir = join(linkRootDir, "workspace");
    await writeConfig(rootDir, {
      version: 1,
      safety: {
        dryRun: false,
        allowWrite: true,
        allowedCommands: ["git"]
      }
    });
    await symlink(
      rootDir,
      aliasRootDir,
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await loadCwConfig(aliasRootDir);
    const context = await resolveExecutionContext({ rootDir: aliasRootDir });

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.config.safety.allowWrite).toBe(true);
    expect(context.allowWrite).toBe(true);
    expect(context.dryRun).toBe(false);
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

    const result = await loadCwConfig(rootDir);

    expect(result.exists).toBe(true);
    expect(result.error).toContain("baseURL");
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("applies precedence cli overrides > config > env > defaults for persisted runtime settings", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      workerModel: {
        provider: "litellm",
        model: "config-worker",
        apiKey: "config-secret"
      },
      workerClientCommand: "config-client",
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
        WORKER_MODEL_API_KEY: "env-secret",
        CW_DRY_RUN: "true"
      },
      cliOverrides: {
        allowWrite: true,
        workerModel: {
          apiKey: "cli-secret",
          provider: "cli-provider",
          model: "cli-worker"
        }
      }
    });

    expect(context.workerModel.provider).toBe("cli-provider");
    expect(context.workerModel.model).toBe("cli-worker");
    expect(context.workerModel.apiKey).toBe("cli-secret");
    expect(context.workerModel.clientCommand).toBe("config-client");
    expect(context.dryRun).toBe(false);
    expect(context.allowWrite).toBe(true);
    expect(context.allowedCommands).toEqual(["git"]);
  });

  it("uses env fallbacks when persisted config does not exist", async () => {
    const rootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      rootDir,
      env: {
        WORKER_MODEL_PROVIDER: "openai-compatible",
        WORKER_MODEL_NAME: "env-worker",
        CW_DRY_RUN: "false",
        CW_ALLOW_WRITE: "true",
        CW_ALLOWED_COMMANDS: "git,node"
      }
    });

    expect(context.workerModel.provider).toBe("openai-compatible");
    expect(context.workerModel.model).toBe("env-worker");
    expect(context.dryRun).toBe(false);
    expect(context.allowWrite).toBe(true);
    expect(context.allowedCommands).toEqual(["git", "node"]);
  });

  it("uses CW_WORKSPACE_DIR when rootDir is not passed explicitly", async () => {
    const rootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      env: {
        CW_WORKSPACE_DIR: rootDir
      }
    });

    expect(context.rootDir).toBe(rootDir);
  });

  it("prefers explicit rootDir over CW_WORKSPACE_DIR", async () => {
    const rootDir = await createWorkspace();
    const envRootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      rootDir,
      env: {
        CW_WORKSPACE_DIR: envRootDir
      }
    });

    expect(context.rootDir).toBe(rootDir);
  });

  it("resolves context selection settings from config", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 1,
      context: {
        ignoredPaths: ["generated", "tmp/cache"],
        strictFiles: true
      }
    });

    const context = await resolveExecutionContext({ rootDir });

    expect(context.contextBudget.ignoredPaths).toEqual(["generated", "tmp/cache"]);
    expect(context.contextBudget.strictFiles).toBe(true);
  });
});
