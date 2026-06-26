import {
  AgentError,
  type ExecutionContext,
  type ModelConfig,
  type WorkerRegistration
} from "@agent-orchestrator/core";

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
  registration: WorkerRegistration
): ModelConfig => ({
  provider: registration.provider,
  model: registration.model,
  baseURL: registration.baseURL,
  apiKey: registration.apiKeyEnvVar
    ? process.env[registration.apiKeyEnvVar]
    : undefined
});

export const resolveWorkerModel = async ({
  context,
  workerId
}: ResolveWorkerModelInput): Promise<ResolveWorkerModelResult> => {
  const defaultWorkerId = deriveWorkerRegistrationId(context.workerModel);
  const resolvedWorkerId = workerId ?? defaultWorkerId;
  const registration = await getWorkerRegistration(
    context.rootDir,
    resolvedWorkerId,
    context.aoStorageDir
  );

  if (registration) {
    if (!registration.enabled) {
      throw new AgentError(
        "WORKER_DISABLED",
        `Worker ${resolvedWorkerId} is registered but disabled.`,
        { workerId: resolvedWorkerId }
      );
    }

    return {
      workerId: resolvedWorkerId,
      registration,
      modelConfig: modelConfigFromRegistration(registration),
      source: "registry",
      warnings: []
    };
  }

  if (workerId) {
    throw new AgentError(
      "WORKER_NOT_REGISTERED",
      `Worker ${workerId} is not registered.`,
      { workerId }
    );
  }

  return {
    workerId: defaultWorkerId,
    registration: null,
    modelConfig: context.workerModel,
    source: "env-default",
    warnings: []
  };
};
