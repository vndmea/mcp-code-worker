import {
  AgentError,
  type AgentRole,
  type ModelConfig,
  type WorkerCapabilityProfile,
  type WorkerTaskType
} from "@mcp-code-worker/core";

import { AiSdkProvider } from "../providers/ai-sdk-provider.js";
import { AnthropicProvider } from "../providers/anthropic-provider.js";
import { ClaudeCodeProvider } from "../providers/claudecode-provider.js";
import { CodexProvider } from "../providers/codex-provider.js";
import { LiteLlmProvider } from "../providers/litellm-provider.js";
import { LocalClientProvider } from "../providers/local-client-provider.js";
import { MockModelProvider } from "../providers/mock-provider.js";
import { OpencodeProvider } from "../providers/opencode-provider.js";
import {
  resolveModelBehaviorProfile,
  type ModelBehaviorProfile
} from "../profiles/model-behavior-profile.js";
import type { ModelProvider } from "../types/model-provider.js";
import { assessWorkerTaskEligibility } from "./worker-routing.js";

export interface RoutedModel {
  behaviorProfile: ModelBehaviorProfile;
  config: ModelConfig;
  provider: ModelProvider;
  role: AgentRole;
}

export class ModelRouter {
  private readonly providers: Map<string, ModelProvider>;

  public constructor(private readonly workerModel: ModelConfig) {
    const anthropicProvider = new AnthropicProvider();

    this.providers = new Map<string, ModelProvider>([
      ["mock", new MockModelProvider()],
      ["openai-compatible", new AiSdkProvider()],
      ["claude-compatible", anthropicProvider],
      ["claudecode", new ClaudeCodeProvider()],
      ["codex", new CodexProvider()],
      ["client", new LocalClientProvider()],
      ["opencode", new OpencodeProvider()],
      ["litellm", new LiteLlmProvider()]
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

  public route(role: AgentRole): RoutedModel {
    const config = this.workerModel;
    const provider = this.providers.get(config.provider);

    if (!provider) {
      throw new AgentError(
        "MODEL_PROVIDER_UNSUPPORTED",
        `Unsupported worker provider '${config.provider}'. Expected one of: ${Array.from(this.providers.keys()).join(", ")}.`,
        {
          provider: config.provider
        }
      );
    }

    return {
      behaviorProfile: resolveModelBehaviorProfile(config),
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
