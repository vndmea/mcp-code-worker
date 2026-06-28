import {
  AgentError,
  type ExecutionContext,
  type ModelConfig,
  type WorkerRegistration
} from "@mcp-code-worker/core";

import {
  deriveWorkerRegistrationId,
  getWorkerRegistration
} from "./worker-registry-store.js";

export interface ResolveWorkerModelInput {
  context: ExecutionContext;
  workerId?: string;
}

export interface ResolveWorkerModelResult {
  modelConfig: ModelConfig;
  registration: WorkerRegistration | null;
  source: "registry" | "env-default";
  warnings: string[];
  workerId: string;
}

const modelConfigFromRegistration = (
  registration: WorkerRegistration,
  context: ExecutionContext
): ModelConfig => ({
  provider: registration.provider,
  model: registration.model,
  baseURL: registration.baseURL ?? context.workerModel.baseURL,
  apiKey: context.workerModel.apiKey,
  temperature: context.workerModel.temperature,
  maxTokens: context.workerModel.maxTokens
});

const requiresApiKey = (config: ModelConfig): boolean =>
  !["client", "local-client", "mock"].includes(config.provider);

export const resolveWorkerModel = async ({
  context,
  workerId
}: ResolveWorkerModelInput): Promise<ResolveWorkerModelResult> => {
  const fallbackWorkerId = deriveWorkerRegistrationId(context.workerModel);
  const configuredDefaultWorkerId = context.defaultWorkerId;
  const resolvedWorkerId =
    workerId ?? configuredDefaultWorkerId ?? fallbackWorkerId;
  const registration = await getWorkerRegistration(
    context.rootDir,
    resolvedWorkerId,
    context.cwStorageDir
  );

  if (registration) {
    if (!registration.enabled) {
      throw new AgentError(
        "WORKER_DISABLED",
        `Worker ${resolvedWorkerId} is registered but disabled.`,
        { workerId: resolvedWorkerId }
      );
    }

    const modelConfig = modelConfigFromRegistration(registration, context);
    if (requiresApiKey(modelConfig) && !modelConfig.apiKey) {
      throw new AgentError(
        "WORKER_MODEL_API_KEY_MISSING",
        `Worker ${resolvedWorkerId} requires WORKER_MODEL_API_KEY to be set before it can run.`,
        {
          workerId: resolvedWorkerId
        }
      );
    }

    return {
      workerId: resolvedWorkerId,
      registration,
      modelConfig,
      source: "registry",
      warnings: []
    };
  }

  if (workerId || configuredDefaultWorkerId) {
    throw new AgentError(
      "WORKER_NOT_REGISTERED",
      `Worker ${resolvedWorkerId} is not registered.`,
      { workerId: resolvedWorkerId }
    );
  }

  if (requiresApiKey(context.workerModel) && !context.workerModel.apiKey) {
    throw new AgentError(
      "WORKER_MODEL_API_KEY_MISSING",
      `Worker ${fallbackWorkerId} requires WORKER_MODEL_API_KEY to be set before it can run.`,
      {
        workerId: fallbackWorkerId
      }
    );
  }

  return {
    workerId: fallbackWorkerId,
    registration: null,
    modelConfig: context.workerModel,
    source: "env-default",
    warnings: []
  };
};
