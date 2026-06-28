import { readFile } from "node:fs/promises";

import type {
  ExecutionContext,
  ExecutionContextOverrides
} from "../runtime/execution-context.js";
import { createExecutionContextFromEnv } from "../runtime/execution-context.js";
import {
  normalizeCommandInput,
  normalizeFileSystemPath
} from "../runtime/path-input.js";
import { getCwWorkspaceFilePath } from "../storage/cw-paths.js";
import { CwConfigSchema, type CwConfig, type CwModelConfig } from "../schemas/config.schema.js";

export interface LoadCwConfigResult {
  config: CwConfig;
  error?: string;
  exists: boolean;
  path: string;
}

export interface ResolveExecutionContextOptions {
  cliOverrides?: ExecutionContextOverrides;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
}

export const getCwConfigPath = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getCwWorkspaceFilePath(rootDir, "config.json", env);

const buildDefaultConfig = (): CwConfig =>
  CwConfigSchema.parse({
    version: 1
  });

const hasEnvValue = (env: NodeJS.ProcessEnv, key: string): boolean =>
  typeof env[key] === "string" && env[key].length > 0;

const resolveRootDir = (
  env: NodeJS.ProcessEnv,
  options: ResolveExecutionContextOptions
): string => {
  const cliOverrides = options.cliOverrides ?? {};
  const configuredRootDir =
    options.rootDir ?? cliOverrides.rootDir ?? env.CW_ROOT_DIR ?? process.cwd();

  return normalizeFileSystemPath(configuredRootDir);
};

const mergeModelConfig = (
  base: ExecutionContext["workerModel"],
  configModel: CwModelConfig | undefined,
  configWorkerClientCommand: string | undefined,
  env: NodeJS.ProcessEnv,
  envPrefix: "WORKER",
  cliOverride?: ExecutionContextOverrides["workerModel"]
) => {
  const provider =
    cliOverride?.provider ??
    (hasEnvValue(env, `${envPrefix}_MODEL_PROVIDER`) ? base.provider : configModel?.provider ?? base.provider);
  const model =
    cliOverride?.model ??
    (hasEnvValue(env, `${envPrefix}_MODEL_NAME`) ? base.model : configModel?.model ?? base.model);
  const baseURL =
    cliOverride?.baseURL ??
    (hasEnvValue(env, `${envPrefix}_MODEL_BASE_URL`) ? base.baseURL : configModel?.baseURL ?? base.baseURL);
  const clientCommand =
    cliOverride?.clientCommand ??
    (hasEnvValue(env, "CW_WORKER_CLIENT_COMMAND")
      ? base.clientCommand
      : configWorkerClientCommand
        ? normalizeCommandInput(configWorkerClientCommand)
        : base.clientCommand);
  const apiKey = cliOverride?.apiKey ?? base.apiKey;
  const temperature = cliOverride?.temperature ?? configModel?.temperature ?? base.temperature;
  const maxTokens = cliOverride?.maxTokens ?? configModel?.maxTokens ?? base.maxTokens;

  return {
    provider,
    model,
    baseURL,
    clientCommand,
    apiKey,
    temperature,
    maxTokens
  };
};

export async function loadCwConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<LoadCwConfigResult> {
  const path = getCwConfigPath(rootDir, env);

  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    const config = CwConfigSchema.safeParse(parsed);

    if (!config.success) {
      return {
        exists: true,
        path,
        config: buildDefaultConfig(),
        error: config.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")
      };
    }

    return {
      exists: true,
      path,
      config: config.data
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissing = /ENOENT/u.test(message);

    return {
      exists: !isMissing,
      path,
      config: buildDefaultConfig(),
      ...(isMissing ? {} : { error: message })
    };
  }
}

export async function resolveExecutionContext(
  options: ResolveExecutionContextOptions = {}
): Promise<ExecutionContext> {
  const env = options.env ?? process.env;
  const cliOverrides = options.cliOverrides ?? {};
  const rootDir = resolveRootDir(env, options);
  const configResult = await loadCwConfig(rootDir, env);
  const baseContext = createExecutionContextFromEnv(env, {
    ...cliOverrides,
    rootDir
  });
  const config = configResult.config;

  const dryRun =
    cliOverrides.dryRun ??
    (hasEnvValue(env, "CW_DRY_RUN") ? baseContext.dryRun : config.safety.dryRun);
  const allowWrite =
    cliOverrides.allowWrite ??
    (hasEnvValue(env, "CW_ALLOW_WRITE")
      ? baseContext.allowWrite
      : config.safety.allowWrite);
  const allowedCommands =
    cliOverrides.allowedCommands ??
    (hasEnvValue(env, "CW_ALLOWED_COMMANDS")
      ? baseContext.allowedCommands
      : config.safety.allowedCommands);
  const contextBudget = {
    ...baseContext.contextBudget,
    ...(cliOverrides.contextBudget ?? config.context),
    ignoredPaths:
      cliOverrides.contextBudget?.ignoredPaths ??
      config.context.ignoredPaths
  };
  const workerModel = mergeModelConfig(
    baseContext.workerModel,
    config.workerModel,
    config.workerClientCommand,
    env,
    "WORKER",
    cliOverrides.workerModel
  );

  return createExecutionContextFromEnv(env, {
    ...cliOverrides,
    defaultWorkerId:
      cliOverrides.defaultWorkerId ?? config.defaultWorkerId,
    rootDir,
    dryRun,
    allowWrite,
    allowedCommands,
    contextBudget,
    workerModel
  });
}
