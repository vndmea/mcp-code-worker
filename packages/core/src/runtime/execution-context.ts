import { getCwWorkspaceDir } from "../storage/cw-paths.js";
import type { ModelConfig } from "../types/workflow.js";
import { SafetyPolicy } from "../policies/safety-policy.js";
import { WritePolicy } from "../policies/write-policy.js";
import {
  normalizeCommandInput,
  normalizeFileSystemPath
} from "./path-input.js";

export interface ExecutionContext {
  cwStorageDir: string;
  defaultWorkerId?: string;
  rootDir: string;
  dryRun: boolean;
  allowWrite: boolean;
  allowedCommands: string[];
  contextBudget: {
    ignoredPaths: string[];
    strictFiles: boolean;
  };
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
  contextBudget?: Partial<ExecutionContext["contextBudget"]>;
  defaultWorkerId?: string;
  dryRun?: boolean;
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

const DEFAULT_CONTEXT_BUDGET: ExecutionContext["contextBudget"] = {
  strictFiles: false,
  ignoredPaths: [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next"
  ]
};

export const createExecutionContextFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  overrides: ExecutionContextOverrides = {}
): ExecutionContext => {
  const rootDir = normalizeFileSystemPath(
    overrides.rootDir ?? env.CW_ROOT_DIR ?? process.cwd()
  );
  const cwStorageDir = getCwWorkspaceDir(rootDir, env);
  const dryRun = overrides.dryRun ?? parseBoolean(env.CW_DRY_RUN, true);
  const allowWrite =
    overrides.allowWrite ?? parseBoolean(env.CW_ALLOW_WRITE, false);
  const allowedCommands =
    overrides.allowedCommands ??
    parseList(env.CW_ALLOWED_COMMANDS, ["git", "node", "pnpm"]);
  const contextBudget = {
    ...DEFAULT_CONTEXT_BUDGET,
    ...overrides.contextBudget,
    ignoredPaths:
      overrides.contextBudget?.ignoredPaths ??
      DEFAULT_CONTEXT_BUDGET.ignoredPaths
  };

  const workerModel = mergeModelConfig(
    {
      provider: env.WORKER_MODEL_PROVIDER ?? "mock",
      model: env.WORKER_MODEL_NAME ?? "gpt-5.4-mini",
      baseURL: env.WORKER_MODEL_BASE_URL || undefined,
      apiKey: env.WORKER_MODEL_API_KEY || undefined,
      clientCommand: env.CW_WORKER_CLIENT_COMMAND
        ? normalizeCommandInput(env.CW_WORKER_CLIENT_COMMAND)
        : undefined,
      temperature: 0.1
    },
    overrides.workerModel
  );

  const safetyPolicy = new SafetyPolicy({
    allowedCommands,
    dryRun
  });
  const writePolicy = new WritePolicy({
    additionalRootDirs: [cwStorageDir],
    allowWrite,
    dryRun,
    rootDir
  });

  return {
    cwStorageDir,
    defaultWorkerId: overrides.defaultWorkerId,
    rootDir,
    dryRun,
    allowWrite,
    allowedCommands,
    contextBudget,
    workerModel,
    serverName: overrides.serverName ?? env.MCP_SERVER_NAME ?? "mcp-code-worker",
    serverVersion: overrides.serverVersion ?? env.MCP_SERVER_VERSION ?? "0.1.0",
    logLevel: overrides.logLevel ?? env.LOG_LEVEL ?? "info",
    safetyPolicy,
    writePolicy
  };
};

export const createExecutionContextWithWorkerModel = (
  context: ExecutionContext,
  workerModel: ModelConfig
): ExecutionContext => ({
  ...context,
  workerModel
});
