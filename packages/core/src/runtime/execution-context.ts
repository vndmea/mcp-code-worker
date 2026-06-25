import type { ModelConfig } from "../types/workflow.js";
import { SafetyPolicy } from "../policies/safety-policy.js";
import { WritePolicy } from "../policies/write-policy.js";

export interface ExecutionContext {
  rootDir: string;
  dryRun: boolean;
  allowWrite: boolean;
  allowedCommands: string[];
  leaderModel: ModelConfig;
  workerModel: ModelConfig;
  serverName: string;
  serverVersion: string;
  logLevel: string;
  safetyPolicy: SafetyPolicy;
  writePolicy: WritePolicy;
}

export interface ExecutionContextOverrides {
  allowWrite?: boolean;
  allowedCommands?: string[];
  dryRun?: boolean;
  leaderModel?: Partial<ModelConfig>;
  logLevel?: string;
  rootDir?: string;
  serverName?: string;
  serverVersion?: string;
  workerModel?: Partial<ModelConfig>;
}

const parseBoolean = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === "true";
};

const parseList = (value: string | undefined, fallback: string[]) => {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const mergeModelConfig = (
  base: ModelConfig,
  override?: Partial<ModelConfig>
): ModelConfig => ({
  ...base,
  ...override
});

export const createExecutionContextFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  overrides: ExecutionContextOverrides = {}
): ExecutionContext => {
  const rootDir = overrides.rootDir ?? process.cwd();
  const dryRun = overrides.dryRun ?? parseBoolean(env.AO_DRY_RUN, true);
  const allowWrite =
    overrides.allowWrite ?? parseBoolean(env.AO_ALLOW_WRITE, false);
  const allowedCommands =
    overrides.allowedCommands ??
    parseList(env.AO_ALLOWED_COMMANDS, ["git", "node", "pnpm"]);

  const leaderModel = mergeModelConfig(
    {
      provider: env.LEADER_MODEL_PROVIDER ?? "mock",
      model: env.LEADER_MODEL_NAME ?? "gpt-5.4",
      baseURL: env.LEADER_MODEL_BASE_URL || undefined,
      apiKey: env.LEADER_MODEL_API_KEY || undefined,
      temperature: 0.2,
      maxTokens: 4000
    },
    overrides.leaderModel
  );

  const workerModel = mergeModelConfig(
    {
      provider: env.WORKER_MODEL_PROVIDER ?? "mock",
      model: env.WORKER_MODEL_NAME ?? "gpt-5.4-mini",
      baseURL: env.WORKER_MODEL_BASE_URL || undefined,
      apiKey: env.WORKER_MODEL_API_KEY || undefined,
      temperature: 0.1,
      maxTokens: 2000
    },
    overrides.workerModel
  );

  const safetyPolicy = new SafetyPolicy({
    allowedCommands,
    dryRun
  });
  const writePolicy = new WritePolicy({
    allowWrite,
    dryRun,
    rootDir
  });

  return {
    rootDir,
    dryRun,
    allowWrite,
    allowedCommands,
    leaderModel,
    workerModel,
    serverName: overrides.serverName ?? env.MCP_SERVER_NAME ?? "agent-orchestrator",
    serverVersion: overrides.serverVersion ?? env.MCP_SERVER_VERSION ?? "0.1.0",
    logLevel: overrides.logLevel ?? env.LOG_LEVEL ?? "info",
    safetyPolicy,
    writePolicy
  };
};
