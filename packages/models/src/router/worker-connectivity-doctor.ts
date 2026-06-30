import type { DoctorCheck, ExecutionContext, ModelConfig } from "@mcp-code-worker/core";

import {
  inspectConfiguredClaudeCodeCommand
} from "../providers/claudecode-command.js";
import {
  inspectConfiguredCodexCommand
} from "../providers/codex-command.js";
import {
  inspectConfiguredLocalClientCommand
} from "../providers/local-client-command.js";
import {
  inspectConfiguredOpencodeCommand
} from "../providers/opencode-command.js";
import { ModelRouter } from "./model-router.js";
import { resolveWorkerTarget } from "./worker-target-resolution.js";

const LOCAL_CLIENT_PROVIDERS = new Set(["client"]);
const CLAUDE_CODE_PROVIDERS = new Set(["claudecode"]);
const CODEX_PROVIDERS = new Set(["codex"]);
const OPENCODE_PROVIDERS = new Set(["opencode"]);

const summarizeWorkerResponse = (value: string): string =>
  value.replaceAll(/\s+/gu, " ").trim().slice(0, 160);

const createProbeConfig = (modelConfig: ModelConfig): ModelConfig => ({
  ...modelConfig,
  maxTokens:
    modelConfig.maxTokens !== undefined
      ? Math.min(modelConfig.maxTokens, 32)
      : 32,
  temperature: 0
});

export const createLocalClientDoctorChecks = async (
  context: ExecutionContext,
  options: {
    workerId?: string;
  } = {}
): Promise<DoctorCheck[]> => {
  let resolvedWorker:
    | Awaited<ReturnType<typeof resolveWorkerTarget>>
    | undefined;

  if (options.workerId) {
    try {
      resolvedWorker = await resolveWorkerTarget({
        context,
        workerId: options.workerId
      });
    } catch {
      return [];
    }
  }

  const modelConfig = resolvedWorker?.modelConfig ?? context.workerModel;

  if (
    !LOCAL_CLIENT_PROVIDERS.has(modelConfig.provider) &&
    !CLAUDE_CODE_PROVIDERS.has(modelConfig.provider) &&
    !CODEX_PROVIDERS.has(modelConfig.provider) &&
    !OPENCODE_PROVIDERS.has(modelConfig.provider)
  ) {
    return [];
  }

  const inspection =
    LOCAL_CLIENT_PROVIDERS.has(modelConfig.provider)
      ? await inspectConfiguredLocalClientCommand(modelConfig, {
          checkCompatibility: true
        })
      : CLAUDE_CODE_PROVIDERS.has(modelConfig.provider)
        ? await inspectConfiguredClaudeCodeCommand(modelConfig, {
            checkCompatibility: true
          })
      : CODEX_PROVIDERS.has(modelConfig.provider)
        ? await inspectConfiguredCodexCommand(modelConfig, {
            checkCompatibility: true
          })
      : await inspectConfiguredOpencodeCommand(modelConfig, {
          checkCompatibility: true
        });
  const resolvedCommand = inspection.resolvedPath ?? inspection.command;

  return [
    {
      name: "local-client-command",
      status: inspection.resolvedPath ? "pass" : "fail",
      message: inspection.resolvedPath
        ? `Resolved local client command '${inspection.command}' to '${inspection.resolvedPath}' (${inspection.source}).`
        : inspection.compatibility.message,
      metadata: {
        command: inspection.command,
        configuredCommand: inspection.configuredCommand ?? "(default)",
        resolvedCommand,
        resolvedPath: inspection.resolvedPath,
        source: inspection.source,
        workerId: resolvedWorker?.workerId ?? options.workerId
      }
    },
    {
      name: "local-client-compatibility",
      status:
        inspection.status === "fail"
          ? "fail"
          : inspection.status === "warning"
            ? "warning"
            : "pass",
      message:
        inspection.status === "fail"
          ? inspection.compatibility.message
          : inspection.compatibility.checked
            ? inspection.compatibility.message
            : "Local client compatibility probe was skipped.",
      metadata: {
        command: inspection.command,
        compatibilityChecked: inspection.compatibility.checked,
        configuredCommand: inspection.configuredCommand ?? "(default)",
        isPathLike: inspection.isPathLike,
        resolvedCommand,
        resolvedPath: inspection.resolvedPath,
        source: inspection.source,
        stderrPreview: inspection.compatibility.stderr?.slice(0, 300),
        stdoutPreview: inspection.compatibility.stdout?.slice(0, 300),
        workerId: resolvedWorker?.workerId ?? options.workerId
      }
    }
  ];
};

export const createWorkerConnectivityDoctorChecks = async (
  context: ExecutionContext,
  options: {
    workerId?: string;
  } = {}
): Promise<DoctorCheck[]> => {
  let resolvedWorker:
    | Awaited<ReturnType<typeof resolveWorkerTarget>>
    | undefined;
  let probeConfig = createProbeConfig(context.workerModel);
  let localClientInspection:
    | Awaited<ReturnType<typeof inspectConfiguredLocalClientCommand>>
    | Awaited<ReturnType<typeof inspectConfiguredClaudeCodeCommand>>
    | Awaited<ReturnType<typeof inspectConfiguredCodexCommand>>
    | Awaited<ReturnType<typeof inspectConfiguredOpencodeCommand>>
    | null = null;

  try {
    resolvedWorker = options.workerId
      ? await resolveWorkerTarget({
          context,
          workerId: options.workerId
        })
      : undefined;
    probeConfig = createProbeConfig(
      resolvedWorker?.modelConfig ?? context.workerModel
    );
    localClientInspection =
      LOCAL_CLIENT_PROVIDERS.has(probeConfig.provider)
        ? await inspectConfiguredLocalClientCommand(probeConfig, {
            checkCompatibility: false
          })
        : CLAUDE_CODE_PROVIDERS.has(probeConfig.provider)
        ? await inspectConfiguredClaudeCodeCommand(probeConfig, {
            checkCompatibility: false
          })
        : CODEX_PROVIDERS.has(probeConfig.provider)
          ? await inspectConfiguredCodexCommand(probeConfig, {
              checkCompatibility: false
            })
        : OPENCODE_PROVIDERS.has(probeConfig.provider)
          ? await inspectConfiguredOpencodeCommand(probeConfig, {
              checkCompatibility: false
            })
          : null;
    const router = new ModelRouter(probeConfig);
    const routed = router.route("worker");
    const result = await routed.provider.invoke(probeConfig, {
      prompt: "Reply with exactly: cw-doctor-ok",
      systemPrompt: "Return plain text only.",
      metadata: {
        reason: "cw-doctor-connectivity"
      }
    });

    return [
      {
        name: "worker-connectivity",
        status: "pass",
        message: resolvedWorker?.workerId
          ? `Resolved worker ${resolvedWorker.workerId} responded to the connectivity probe.`
          : "The active worker model responded to the connectivity probe.",
        metadata: {
          baseURL: probeConfig.baseURL,
          model: probeConfig.model,
          provider: probeConfig.provider,
          responsePreview: summarizeWorkerResponse(result.text),
          clientCommand: localClientInspection?.command ?? probeConfig.clientCommand,
          configuredCommand:
            localClientInspection?.configuredCommand ?? probeConfig.clientCommand,
          resolvedCommand:
            localClientInspection?.resolvedPath ?? localClientInspection?.command,
          resolvedPath: localClientInspection?.resolvedPath,
          source: resolvedWorker?.source ?? "active-runtime",
          clientCommandSource: localClientInspection?.source,
          workerId: resolvedWorker?.workerId ?? options.workerId
        }
      }
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return [
      {
        name: "worker-connectivity",
        status: "warning",
        message: `Worker connectivity probe failed: ${message}`,
        metadata: {
          baseURL: probeConfig.baseURL,
          clientCommand:
            localClientInspection?.command ?? probeConfig.clientCommand,
          configuredCommand:
            localClientInspection?.configuredCommand ??
            probeConfig.clientCommand ??
            "(default)",
          error: message,
          model: probeConfig.model,
          provider: probeConfig.provider,
          resolvedCommand:
            localClientInspection?.resolvedPath ?? localClientInspection?.command,
          resolvedPath: localClientInspection?.resolvedPath,
          source: resolvedWorker?.source ?? "active-runtime",
          rootDir: context.rootDir,
          clientCommandSource: localClientInspection?.source,
          workerId: resolvedWorker?.workerId ?? options.workerId
        }
      }
    ];
  }
};
