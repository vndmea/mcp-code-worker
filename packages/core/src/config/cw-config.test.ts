import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCwConfigPath,
  loadCwConfig,
  normalizeCommandInput,
  normalizeFileSystemPath,
  resolveConfiguredWorkerModel,
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
    expect(result.config.version).toBe(2);
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("loads valid config and resolves persisted per-worker model settings", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 2,
      workers: [
        {
          workerId: "deepseek-flash",
          provider: "litellm",
          model: "qwen3-coder-mini",
          clientCommand: "custom-client",
          enabled: true,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      safety: {
        dryRun: false,
        allowWrite: true,
        allowedCommands: ["git", "pnpm"]
      }
    });

    const result = await loadCwConfig(rootDir);
    const context = await resolveExecutionContext({ rootDir });
    const worker = resolveConfiguredWorkerModel(result.config, "deepseek-flash");

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
    expect(worker?.provider).toBe("litellm");
    expect(worker?.clientCommand).toBe("custom-client");
    expect(context.workerModel.provider).toBe("mock");
    expect(context.allowWrite).toBe(true);
    expect(context.dryRun).toBe(false);
    expect(context.contextBudget.strictFiles).toBe(false);
  });

  it("loads persisted config through canonical workspace path aliases", async () => {
    const rootDir = await createWorkspace();
    const linkRootDir = await mkdtemp(join(tmpdir(), "cw-config-link-"));
    const aliasRootDir = join(linkRootDir, "workspace");
    await writeConfig(rootDir, {
      version: 2,
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
      version: 2,
      workers: [
        {
          workerId: "bad-worker",
          provider: "litellm",
          model: "qwen3-coder",
          baseURL: "not-a-url"
        }
      ]
    });

    const result = await loadCwConfig(rootDir);

    expect(result.exists).toBe(true);
    expect(result.error).toContain("baseURL");
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("applies precedence cli overrides > defaults for active runtime settings", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 2,
      workers: [
        {
          workerId: "config-worker",
          provider: "litellm",
          model: "config-worker",
          clientCommand: "config-client",
          enabled: true,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      safety: {
        dryRun: false,
        allowWrite: false,
        allowedCommands: ["git"]
      }
    });

    const context = await resolveExecutionContext({
      rootDir,
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
    expect(context.workerModel.clientCommand).toBeUndefined();
    expect(context.dryRun).toBe(false);
    expect(context.allowWrite).toBe(true);
    expect(context.allowedCommands).toEqual(["git"]);
  });

  it("uses built-in worker defaults when persisted config does not exist", async () => {
    const rootDir = await createWorkspace();

    const context = await resolveExecutionContext({
      rootDir
    });

    expect(context.workerModel.provider).toBe("mock");
    expect(context.workerModel.model).toBe("gpt-5.4-mini");
    expect(context.dryRun).toBe(true);
    expect(context.allowWrite).toBe(false);
    expect(context.allowedCommands).toEqual(["git", "node", "pnpm"]);
  });

  it("uses the current working directory when rootDir is not passed explicitly", async () => {
    const rootDir = await createWorkspace();
    const originalCwd = process.cwd();

    try {
      process.chdir(rootDir);
      const expectedRootDir = normalizeFileSystemPath(process.cwd());
      const context = await resolveExecutionContext();
      expect(context.rootDir).toBe(expectedRootDir);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("prefers explicit rootDir over the current working directory", async () => {
    const rootDir = await createWorkspace();
    const cwdRootDir = await createWorkspace();
    const originalCwd = process.cwd();

    try {
      process.chdir(cwdRootDir);
      const context = await resolveExecutionContext({
        rootDir
      });
      expect(context.rootDir).toBe(rootDir);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("resolves context selection settings from config", async () => {
    const rootDir = await createWorkspace();
    await writeConfig(rootDir, {
      version: 2,
      context: {
        ignoredPaths: ["generated", "tmp/cache"],
        strictFiles: true
      }
    });

    const context = await resolveExecutionContext({ rootDir });

    expect(context.contextBudget.ignoredPaths).toEqual(["generated", "tmp/cache"]);
    expect(context.contextBudget.strictFiles).toBe(true);
  });

  it("resolves per-worker client command mappings from config", async () => {
    const rootDir = await createWorkspace();
    const now = new Date().toISOString();
    await writeConfig(rootDir, {
      version: 2,
      workers: [
        {
          workerId: "opencode-local",
          provider: "opencode",
          model: "deepseek/deepseek-v4-flash",
          clientCommand: "C:/tools/opencode.exe",
          enabled: true,
          tags: [],
          createdAt: now,
          updatedAt: now
        }
      ]
    });

    const result = await loadCwConfig(rootDir);
    const worker = resolveConfiguredWorkerModel(result.config, "opencode-local");

    expect(worker?.clientCommand).toBe(normalizeCommandInput("C:/tools/opencode.exe"));
  });
});
