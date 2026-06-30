import {
  AgentError,
  type ExecutionContext,
  loadCwConfig,
  type ModelConfig,
  resolveConfiguredWorkerModel,
  type WorkerRegistration
} from "@mcp-code-worker/core";

import { getWorkerRegistration } from "./worker-registry-store.js";

export interface ResolveWorkerTargetInput {
  baseURL?: string;
  context: ExecutionContext;
  model?: string;
  provider?: string;
  workerId: string;
}

export interface ResolveWorkerTargetResult {
  modelConfig: ModelConfig;
  source: "registry";
  warnings: string[];
  workerId: string;
}

const requiresApiKey = (config: ModelConfig): boolean =>
  !["client", "mock", "opencode", "claudecode", "codex"].includes(config.provider);

const modelConfigFromRegistration = (
  registration: WorkerRegistration,
  context: ExecutionContext,
  configuredModel: Partial<ModelConfig> | undefined
): ModelConfig => ({
  provider: configuredModel?.provider ?? registration.provider,
  model: configuredModel?.model ?? registration.model,
  baseURL:
    configuredModel?.baseURL ??
    registration.baseURL ??
    context.workerModel.baseURL,
  apiKey: configuredModel?.apiKey,
  clientCommand: configuredModel?.clientCommand,
  temperature: configuredModel?.temperature ?? context.workerModel.temperature,
  maxTokens: configuredModel?.maxTokens ?? context.workerModel.maxTokens
});

const mergeTargetModelConfig = (
  base: ModelConfig,
  input: Pick<ResolveWorkerTargetInput, "baseURL" | "model" | "provider">
): ModelConfig => ({
  ...base,
  ...(input.provider ? { provider: input.provider } : {}),
  ...(input.model ? { model: input.model } : {}),
  ...(input.baseURL ? { baseURL: input.baseURL } : {})
});

const assertApiKeyIfNeeded = (
  workerId: string | undefined,
  modelConfig: ModelConfig
): void => {
  if (requiresApiKey(modelConfig) && !modelConfig.apiKey) {
    throw new AgentError(
      "WORKER_API_KEY_MISSING",
      `Worker ${workerId ?? "the selected worker"} requires an apiKey entry in config.json workers[] before it can run.`,
      workerId ? { workerId } : undefined
    );
  }
};

export const requireConfiguredWorkerId = (
  context: ExecutionContext,
  workerId: string | undefined,
  action: string
): string => {
  void context;
  if (workerId) {
    return workerId;
  }

  throw new AgentError(
    "WORKER_ID_REQUIRED",
    `No worker id was provided. Pass --worker <id> before continuing with ${action}.`
  );
};

export const resolveWorkerTarget = async (
  input: ResolveWorkerTargetInput
): Promise<ResolveWorkerTargetResult> => {
  const chosenWorkerId = input.workerId;

  const registration = await getWorkerRegistration(
    input.context.rootDir,
    chosenWorkerId,
    input.context.cwStorageDir
  );

  if (!registration) {
    throw new AgentError(
      "WORKER_NOT_REGISTERED",
      `Worker '${chosenWorkerId}' was not found in the worker registry. Check the worker id or register it before continuing.`,
      {
        workerId: chosenWorkerId
      }
    );
  }

  if (!registration.enabled) {
    throw new AgentError(
      "WORKER_DISABLED",
      `Worker ${chosenWorkerId} is registered but disabled.`,
      {
        workerId: chosenWorkerId
      }
    );
  }

  const configResult = await loadCwConfig(input.context.rootDir);
  const configuredModel = resolveConfiguredWorkerModel(
    configResult.config,
    chosenWorkerId
  );

  const modelConfig = mergeTargetModelConfig(
    modelConfigFromRegistration(registration, input.context, configuredModel),
    input
  );
  assertApiKeyIfNeeded(chosenWorkerId, modelConfig);

  return {
    workerId: chosenWorkerId,
    modelConfig,
    source: "registry",
    warnings: []
  };
};
