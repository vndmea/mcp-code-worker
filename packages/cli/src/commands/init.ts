import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type { Command } from "commander";

import {
  AoConfigSchema,
  resolveExecutionContext,
  writeAuditEvent
} from "@agent-orchestrator/core";

import type { CliIo } from "../index.js";

interface InitResult {
  created: string[];
  mode: "execute" | "dry-run";
  recommendedEnv: string[];
  warnings: string[];
  wouldCreate: string[];
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const unique = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const buildConfig = (options: {
  leaderApiKeyEnvVar?: string;
  leaderBaseUrl?: string;
  leaderModel?: string;
  leaderProvider?: string;
  workerApiKeyEnvVar?: string;
  workerBaseUrl?: string;
  workerModel?: string;
  workerProvider?: string;
}) =>
  AoConfigSchema.parse({
    version: 1,
    ...(options.leaderProvider || options.leaderModel || options.leaderBaseUrl || options.leaderApiKeyEnvVar
      ? {
          leaderModel: {
            provider: options.leaderProvider ?? "mock",
            model: options.leaderModel ?? "gpt-5.4",
            ...(options.leaderBaseUrl ? { baseURL: options.leaderBaseUrl } : {}),
            ...(options.leaderApiKeyEnvVar
              ? { apiKeyEnvVar: options.leaderApiKeyEnvVar }
              : {})
          }
        }
      : {}),
    ...(options.workerProvider || options.workerModel || options.workerBaseUrl || options.workerApiKeyEnvVar
      ? {
          workerModel: {
            provider: options.workerProvider ?? "mock",
            model: options.workerModel ?? "gpt-5.4-mini",
            ...(options.workerBaseUrl ? { baseURL: options.workerBaseUrl } : {}),
            ...(options.workerApiKeyEnvVar
              ? { apiKeyEnvVar: options.workerApiKeyEnvVar }
              : {})
          }
        }
      : {})
  });

const ensureDirectory = async (
  rootDir: string,
  path: string,
  allowWrite: boolean,
  result: InitResult
): Promise<void> => {
  const relativePath = relative(rootDir, path).replaceAll("\\", "/");

  if (await exists(path)) {
    return;
  }

  if (!allowWrite) {
    result.wouldCreate.push(relativePath);
    return;
  }

  await mkdir(path, { recursive: true });
  result.created.push(relativePath);
};

const ensureJsonFile = async (
  rootDir: string,
  path: string,
  value: unknown,
  options: {
    allowWrite: boolean;
    force?: boolean;
    result: InitResult;
  }
): Promise<void> => {
  const relativePath = relative(rootDir, path).replaceAll("\\", "/");
  const fileExists = await exists(path);

  if (fileExists && !options.force) {
    return;
  }

  if (!options.allowWrite) {
    options.result.wouldCreate.push(relativePath);
    return;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  options.result.created.push(relativePath);
};

export const registerInitCommand = (program: Command, io: CliIo): void => {
  program
    .command("init")
    .description("Create a local .ao workspace scaffold and starter config.")
    .option("--leader-provider <provider>", "Leader provider")
    .option("--leader-model <model>", "Leader model")
    .option("--leader-base-url <url>", "Leader base URL")
    .option("--leader-api-key-env-var <name>", "Leader API key env var")
    .option("--worker-provider <provider>", "Worker provider")
    .option("--worker-model <model>", "Worker model")
    .option("--worker-base-url <url>", "Worker base URL")
    .option("--worker-api-key-env-var <name>", "Worker API key env var")
    .option("--force", "Overwrite existing config.json", false)
    .option("--allow-write", "Create files and directories", false)
    .action(
      async (options: {
        allowWrite: boolean;
        force: boolean;
        leaderApiKeyEnvVar?: string;
        leaderBaseUrl?: string;
        leaderModel?: string;
        leaderProvider?: string;
        workerApiKeyEnvVar?: string;
        workerBaseUrl?: string;
        workerModel?: string;
        workerProvider?: string;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            allowWrite: options.allowWrite,
            dryRun: !options.allowWrite
          }
        });
        const aoDir = join(context.rootDir, ".ao");
        const configPath = join(aoDir, "config.json");
        const registryPath = join(aoDir, "workers.json");
        const profilesPath = join(aoDir, "worker-profiles.json");
        const auditDir = join(aoDir, "audit");
        const runsDir = join(aoDir, "runs");
        const result: InitResult = {
          mode: options.allowWrite ? "execute" : "dry-run",
          created: [],
          wouldCreate: [],
          warnings: [],
          recommendedEnv: unique([
            options.leaderApiKeyEnvVar,
            options.workerApiKeyEnvVar
          ]).map((name) => `export ${name}=...`)
        };

        await ensureDirectory(context.rootDir, aoDir, options.allowWrite, result);
        await ensureDirectory(context.rootDir, auditDir, options.allowWrite, result);
        await ensureDirectory(context.rootDir, runsDir, options.allowWrite, result);
        await ensureJsonFile(
          context.rootDir,
          configPath,
          buildConfig(options),
          {
            allowWrite: options.allowWrite,
            force: options.force,
            result
          }
        );
        await ensureJsonFile(
          context.rootDir,
          registryPath,
          {
            version: 1,
            workers: []
          },
          {
            allowWrite: options.allowWrite,
            result
          }
        );
        await ensureJsonFile(
          context.rootDir,
          profilesPath,
          [],
          {
            allowWrite: options.allowWrite,
            result
          }
        );

        if (await exists(configPath) && !options.force) {
          const existing = JSON.parse(await readFile(configPath, "utf8")) as unknown;
          AoConfigSchema.parse(existing);
          result.warnings.push("Existing .ao/config.json was preserved.");
        }

        if (options.allowWrite && result.created.length > 0) {
          await writeAuditEvent(
            context,
            {
              actor: "cli",
              action: "init",
              mode: "execute",
              inputSummary: "ao init",
              outputSummary: "Local .ao workspace initialized.",
              warnings: result.warnings,
              errors: [],
              metadata: {
                created: result.created
              }
            },
            true
          );
        }

        io.write(JSON.stringify(result, null, 2));
      }
    );
};
