import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  ExecutionContext,
  ExecutionContextOverrides
} from "../runtime/execution-context.js";
import { createExecutionContextFromEnv } from "../runtime/execution-context.js";
import { getAoWorkspaceFilePath } from "../storage/ao-paths.js";
import { AoConfigSchema, type AoConfig, type AoModelConfig } from "../schemas/config.schema.js";

export interface LoadAoConfigResult {
  config: AoConfig;
  error?: string;
  exists: boolean;
  path: string;
}

export interface ResolveExecutionContextOptions {
  cliOverrides?: ExecutionContextOverrides;
  env?: NodeJS.ProcessEnv;
  rootDir?: string;
}

export const getAoConfigPath = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getAoWorkspaceFilePath(rootDir, "config.json", env);

const buildDefaultConfig = (): AoConfig =>
  AoConfigSchema.parse({
    version: 1
  });

const hasEnvValue = (env: NodeJS.ProcessEnv, key: string): boolean =>
  typeof env[key] === "string" && env[key].length > 0;

const normalizeRootDir = (rootDir: string): string =>
  isAbsolute(rootDir) ? rootDir : resolve(rootDir);

const resolveRootDir = (
  env: NodeJS.ProcessEnv,
  options: ResolveExecutionContextOptions
): string => {
  const cliOverrides = options.cliOverrides ?? {};
  const configuredRootDir =
    options.rootDir ?? cliOverrides.rootDir ?? env.AO_ROOT_DIR ?? process.cwd();

  return normalizeRootDir(configuredRootDir);
};

const mergeModelConfig = (
  base: ExecutionContext["leaderModel"],
  configModel: AoModelConfig | undefined,
  env: NodeJS.ProcessEnv,
  envPrefix: "LEADER" | "WORKER",
  cliOverride?: ExecutionContextOverrides["leaderModel"]
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
  const apiKey = cliOverride?.apiKey ?? base.apiKey;
  const temperature = cliOverride?.temperature ?? configModel?.temperature ?? base.temperature;
  const maxTokens = cliOverride?.maxTokens ?? configModel?.maxTokens ?? base.maxTokens;

  return {
    provider,
    model,
    baseURL,
    apiKey,
    temperature,
    maxTokens
  };
};

export async function loadAoConfig(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<LoadAoConfigResult> {
  const path = getAoConfigPath(rootDir, env);

  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    const config = AoConfigSchema.safeParse(parsed);

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
  const configResult = await loadAoConfig(rootDir, env);
  const baseContext = createExecutionContextFromEnv(env, {
    ...cliOverrides,
    rootDir
  });
  const config = configResult.config;

  const dryRun =
    cliOverrides.dryRun ??
    (hasEnvValue(env, "AO_DRY_RUN") ? baseContext.dryRun : config.safety.dryRun);
  const allowWrite =
    cliOverrides.allowWrite ??
    (hasEnvValue(env, "AO_ALLOW_WRITE")
      ? baseContext.allowWrite
      : config.safety.allowWrite);
  const allowedCommands =
    cliOverrides.allowedCommands ??
    (hasEnvValue(env, "AO_ALLOWED_COMMANDS")
      ? baseContext.allowedCommands
      : config.safety.allowedCommands);
  const contextBudget = {
    ...baseContext.contextBudget,
    ...(cliOverrides.contextBudget ?? config.context),
    ignoredPaths:
      cliOverrides.contextBudget?.ignoredPaths ??
      config.context.ignoredPaths
  };
  const leaderModel = mergeModelConfig(
    baseContext.leaderModel,
    config.leaderModel,
    env,
    "LEADER",
    cliOverrides.leaderModel
  );
  const workerModel = mergeModelConfig(
    baseContext.workerModel,
    config.workerModel,
    env,
    "WORKER",
    cliOverrides.workerModel
  );

  return createExecutionContextFromEnv(env, {
    ...cliOverrides,
    rootDir,
    dryRun,
    allowWrite,
    allowedCommands,
    contextBudget,
    leaderModel,
    workerModel
  });
}
