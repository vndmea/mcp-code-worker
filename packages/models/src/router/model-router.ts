import {
  AgentError,
  type AgentRole,
  type ModelConfig,
  type WorkerCapabilityProfile,
  type WorkerTaskType
} from "@agent-orchestrator/core";

import { AiSdkProvider } from "../providers/ai-sdk-provider.js";
import { LiteLlmProvider } from "../providers/litellm-provider.js";
import { LocalClientProvider } from "../providers/local-client-provider.js";
import { MockModelProvider } from "../providers/mock-provider.js";
import type { ModelProvider } from "../types/model-provider.js";
import { assessWorkerTaskEligibility } from "./worker-routing.js";
import { deriveWorkerProfileId } from "./worker-profile-store.js";

export interface RoutedModel {
  config: ModelConfig;
  provider: ModelProvider;
  role: AgentRole;
}

export class ModelRouter {
  private readonly providers: Map<string, ModelProvider>;

  public constructor(private readonly workerModel: ModelConfig) {
    this.providers = new Map<string, ModelProvider>([
      ["mock", new MockModelProvider()],
      ["openai", new AiSdkProvider()],
      ["openai-compatible", new AiSdkProvider()],
      ["client", new LocalClientProvider()],
      ["litellm", new LiteLlmProvider()],
      ["local-client", new LocalClientProvider()]
    ]);
  }

  public listModels() {
    return [
      {
        role: "worker",
        provider: this.workerModel.provider,
        model: this.workerModel.model
      }
    ];
  }

  public static deriveWorkerId(config: ModelConfig): string {
    return deriveWorkerProfileId(config);
  }

  public route(role: AgentRole): RoutedModel {
    const config = this.workerModel;
    const provider =
      this.providers.get(config.provider) ??
      this.providers.get("mock") ??
      new MockModelProvider();

    return {
      config,
      provider,
      role
    };
  }

  public routeWorkerTask(
    taskType: WorkerTaskType,
    profile?: WorkerCapabilityProfile | null
  ): RoutedModel {
    if (profile) {
      const eligibility = assessWorkerTaskEligibility(profile, taskType);

      if (!eligibility.allowed) {
        throw new AgentError("WORKER_ROUTING_BLOCKED", eligibility.reason, {
          taskType,
          workerId: profile.workerId
        });
      }
    }

    return this.route("worker");
  }
}
