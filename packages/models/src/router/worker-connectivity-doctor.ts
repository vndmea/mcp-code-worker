import type { DoctorCheck, ExecutionContext, ModelConfig } from "@mcp-code-worker/core";

import {
  inspectLocalClientCommand,
  resolveLocalClientCommand
} from "../providers/local-client-command.js";
import { ModelRouter } from "./model-router.js";
import { resolveWorkerTarget } from "./worker-target-resolution.js";

const LOCAL_CLIENT_PROVIDERS = new Set(["client"]);

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
  context: ExecutionContext
): Promise<DoctorCheck[]> => {
  if (!LOCAL_CLIENT_PROVIDERS.has(context.workerModel.provider)) {
    return [];
  }

  const command = resolveLocalClientCommand(context.workerModel);
  const inspection = await inspectLocalClientCommand(command, {
    checkCompatibility: true
  });

  return [
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
        isPathLike: inspection.isPathLike,
        resolvedPath: inspection.resolvedPath,
        stderrPreview: inspection.compatibility.stderr?.slice(0, 300),
        stdoutPreview: inspection.compatibility.stdout?.slice(0, 300)
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

  try {
    resolvedWorker = options.workerId
      ? await resolveWorkerTarget({
          context,
          workerId: options.workerId,
          requireNamedWorker: true
        })
      : undefined;
    const probeConfig = createProbeConfig(
      resolvedWorker?.modelConfig ?? context.workerModel
    );
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
          source: resolvedWorker?.source ?? "ad-hoc",
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
          baseURL: resolvedWorker?.modelConfig.baseURL ?? context.workerModel.baseURL,
          clientCommand:
            resolvedWorker?.modelConfig.clientCommand ??
            context.workerModel.clientCommand,
          error: message,
          model: resolvedWorker?.modelConfig.model ?? context.workerModel.model,
          provider:
            resolvedWorker?.modelConfig.provider ?? context.workerModel.provider,
          rootDir: context.rootDir,
          source: resolvedWorker?.source ?? "ad-hoc",
          workerId: resolvedWorker?.workerId ?? options.workerId
        }
      }
    ];
  }
};
