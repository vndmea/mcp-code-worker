import {
  createExecutionContextWithWorkerModel,
  type ModelConfig,
  type ExecutionContext
} from "@mcp-code-worker/core";
import {
  inspectConfiguredClaudeCodeCommand,
  inspectConfiguredCodexCommand,
  inspectConfiguredOpencodeCommand,
  inspectConfiguredLocalClientCommand,
  requireConfiguredWorkerId,
  resolveWorkerProfile,
  resolveWorkerTarget
} from "@mcp-code-worker/models";

export interface LocalClientRuntimeSummary {
  configuredCommand: string | null;
  resolvedCommand: string;
  resolvedPath: string | null;
  source: "configured" | "default";
}

export interface ResolvedWorkflowWorkerContext {
  context: ExecutionContext;
  localClientRuntime?: LocalClientRuntimeSummary;
  requestedWorkerId: string;
  workerId: string;
}

const resolveLocalClientRuntime = async (
  modelConfig: ModelConfig
): Promise<LocalClientRuntimeSummary | undefined> => {
  if (!["client", "opencode", "claudecode", "codex"].includes(modelConfig.provider)) {
    return undefined;
  }

  const inspection =
    modelConfig.provider === "client"
      ? await inspectConfiguredLocalClientCommand(modelConfig, {
          checkCompatibility: false
        })
      : modelConfig.provider === "claudecode"
        ? await inspectConfiguredClaudeCodeCommand(modelConfig, {
            checkCompatibility: false
          })
        : modelConfig.provider === "codex"
          ? await inspectConfiguredCodexCommand(modelConfig, {
              checkCompatibility: false
            })
      : await inspectConfiguredOpencodeCommand(modelConfig, {
          checkCompatibility: false
        });

  return {
    configuredCommand: inspection.configuredCommand,
    resolvedCommand: inspection.resolvedPath ?? inspection.command,
    resolvedPath: inspection.resolvedPath,
    source: inspection.source
  };
};

export const resolveWorkflowWorkerContext = async (input: {
  activity: string;
  baseURL?: string;
  context: ExecutionContext;
  model?: string;
  provider?: string;
  requireProfile?: boolean;
  workerId?: string;
}): Promise<ResolvedWorkflowWorkerContext> => {
  const requestedWorkerId = requireConfiguredWorkerId(
    input.context,
    input.workerId,
    input.activity
  );
  const resolvedTarget = await resolveWorkerTarget({
    context: input.context,
    workerId: requestedWorkerId,
    provider: input.provider,
    model: input.model,
    baseURL: input.baseURL
  });
  const workerContext = createExecutionContextWithWorkerModel(
    input.context,
    resolvedTarget.modelConfig
  );

  if (input.requireProfile) {
    await resolveWorkerProfile({
      context: workerContext,
      workerId: resolvedTarget.workerId,
      modelConfig: workerContext.workerModel,
      requireProfile: input.requireProfile
    });
  }

  return {
    context: workerContext,
    localClientRuntime: await resolveLocalClientRuntime(workerContext.workerModel),
    requestedWorkerId,
    workerId: resolvedTarget.workerId
  };
};
