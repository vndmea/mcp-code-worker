import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadAoConfig,
  resolveExecutionContext
} from "@agent-orchestrator/core";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-config-"));
  await mkdir(join(rootDir, ".ao"), { recursive: true });
  return rootDir;
};

describe("ao config", () => {
  it("loads defaults when config is missing", async () => {
    const rootDir = await createWorkspace();
    const result = await loadAoConfig(rootDir);

    expect(result.exists).toBe(false);
    expect(result.config.version).toBe(1);
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("loads valid config and resolves apiKeyEnvVar through runtime env", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify(
        {
          version: 1,
          leaderModel: {
            provider: "litellm",
            model: "qwen3-coder",
            apiKeyEnvVar: "TEST_LEADER_KEY"
          },
          workerModel: {
            provider: "litellm",
            model: "qwen3-coder-mini",
            apiKeyEnvVar: "TEST_WORKER_KEY"
          },
          safety: {
            dryRun: false,
            allowWrite: true,
            allowedCommands: ["git", "pnpm"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await loadAoConfig(rootDir);
    const context = await resolveExecutionContext({
      rootDir,
      env: {
        TEST_LEADER_KEY: "leader-secret",
        TEST_WORKER_KEY: "worker-secret"
      }
    });

    expect(result.exists).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.config.leaderModel?.apiKeyEnvVar).toBe("TEST_LEADER_KEY");
    expect(context.leaderModel.provider).toBe("litellm");
    expect(context.leaderModel.apiKey).toBe("leader-secret");
    expect(context.workerModel.apiKey).toBe("worker-secret");
    expect(context.allowWrite).toBe(true);
    expect(context.dryRun).toBe(false);
    expect(context.contextBudget.maxFileBytes).toBe(20_000);
  });

  it("returns clear errors for invalid config and falls back to defaults", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify(
        {
          version: 1,
          leaderModel: {
            provider: "litellm",
            model: "qwen3-coder",
            apiKeyEnvVar: "bad-name"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const result = await loadAoConfig(rootDir);

    expect(result.exists).toBe(true);
    expect(result.error).toContain("apiKeyEnvVar");
    expect(result.config.safety.dryRun).toBe(true);
  });

  it("applies precedence cli overrides > env > config > defaults", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify(
        {
          version: 1,
          leaderModel: {
            provider: "litellm",
            model: "config-leader"
          },
          workerModel: {
            provider: "litellm",
            model: "config-worker"
          },
          safety: {
            dryRun: false,
            allowWrite: false,
            allowedCommands: ["git"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const context = await resolveExecutionContext({
      rootDir,
      env: {
        LEADER_MODEL_PROVIDER: "env-provider",
        LEADER_MODEL_NAME: "env-leader",
        AO_DRY_RUN: "true"
      },
      cliOverrides: {
        allowWrite: true,
        leaderModel: {
          model: "cli-leader"
        },
        workerModel: {
          provider: "cli-provider",
          model: "cli-worker"
        }
      }
    });

    expect(context.leaderModel.provider).toBe("env-provider");
    expect(context.leaderModel.model).toBe("cli-leader");
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
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify(
        {
          version: 1,
          context: {
            maxFileBytes: 128,
            maxTotalBytes: 512,
            ignoredPaths: ["generated", "tmp/cache"]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const context = await resolveExecutionContext({ rootDir });

    expect(context.contextBudget.maxFileBytes).toBe(128);
    expect(context.contextBudget.maxTotalBytes).toBe(512);
    expect(context.contextBudget.ignoredPaths).toEqual(["generated", "tmp/cache"]);
  });
});
