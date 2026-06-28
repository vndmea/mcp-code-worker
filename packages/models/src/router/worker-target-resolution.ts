import {
  AgentError,
  type ExecutionContext,
  type ModelConfig,
  type WorkerRegistration
} from "@mcp-code-worker/core";

import { getWorkerRegistration } from "./worker-registry-store.js";

export interface ResolveWorkerTargetInput {
  baseURL?: string;
  context: ExecutionContext;
  model?: string;
  provider?: string;
  requireNamedWorker?: boolean;
  workerId?: string;
}

export interface ResolveWorkerTargetResult {
  modelConfig: ModelConfig;
  source: "ad-hoc" | "config-default" | "registry";
  warnings: string[];
  workerId?: string;
}

const requiresApiKey = (config: ModelConfig): boolean =>
  !["client", "mock"].includes(config.provider);

const modelConfigFromRegistration = (
  registration: WorkerRegistration,
  context: ExecutionContext
): ModelConfig => ({
  provider: registration.provider,
  model: registration.model,
  baseURL: registration.baseURL ?? context.workerModel.baseURL,
  apiKey: context.workerModel.apiKey,
  clientCommand: context.workerModel.clientCommand,
  temperature: context.workerModel.temperature,
  maxTokens: context.workerModel.maxTokens
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
      "WORKER_MODEL_API_KEY_MISSING",
      `Worker ${workerId ?? "the selected worker"} requires WORKER_MODEL_API_KEY to be set before it can run.`,
      workerId ? { workerId } : undefined
    );
  }
};

export const requireConfiguredWorkerId = (
  context: ExecutionContext,
  workerId: string | undefined,
  action: string
): string => {
  const resolvedWorkerId = workerId ?? context.defaultWorkerId;

  if (resolvedWorkerId) {
    return resolvedWorkerId;
  }

  throw new AgentError(
    "WORKER_ID_REQUIRED",
    `No worker id was provided and config.json does not define defaultWorkerId. Set defaultWorkerId or pass --worker <id> before continuing with ${action}.`
  );
};

export const resolveWorkerTarget = async (
  input: ResolveWorkerTargetInput
): Promise<ResolveWorkerTargetResult> => {
  const chosenWorkerId = input.workerId ?? input.context.defaultWorkerId;

  if (!chosenWorkerId) {
    if (input.requireNamedWorker) {
      throw new AgentError(
        "WORKER_ID_REQUIRED",
        "No worker id was provided and config.json does not define defaultWorkerId. Set defaultWorkerId or pass --worker <id> before continuing."
      );
    }

    const modelConfig = mergeTargetModelConfig(input.context.workerModel, input);
    assertApiKeyIfNeeded(undefined, modelConfig);

    return {
      modelConfig,
      source: "ad-hoc",
      warnings: []
    };
  }

    const registration = await getWorkerRegistration(
    input.context.rootDir,
    chosenWorkerId,
    input.context.cwStorageDir
  );

  if (!registration) {
    throw new AgentError(
      "WORKER_NOT_REGISTERED",
      input.workerId
        ? `Worker '${chosenWorkerId}' was not found in the worker registry. Check the worker id or register it before continuing.`
        : `Configured default worker '${chosenWorkerId}' was not found in the worker registry. Fix config.json or register that worker before continuing.`,
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

  const modelConfig = mergeTargetModelConfig(
    modelConfigFromRegistration(registration, input.context),
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
