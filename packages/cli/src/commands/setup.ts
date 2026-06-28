import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AgentError,
  CwConfigSchema,
  getCwConfigPath,
  getCwWorkspaceAuditDirFromStorageDir,
  getCwWorkspaceRunsDirFromStorageDir,
  loadCwConfig,
  normalizeCommandInput,
  resolveExecutionContext,
  runDoctor,
  writeAuditEvent,
  type CwConfig,
  type ExecutionContext,
  type DoctorCheck,
  type ModelConfig
} from "@mcp-code-worker/core";
import {
  runWorkerInterviewWorkflow,
} from "@mcp-code-worker/graph";
import {
  createWorkerDoctorChecks,
  deriveWorkerRegistrationId,
  getWorkerProfileStorePath,
  getWorkerRegistryPath,
  inspectLocalClientCommand,
  readPersistedWorkerProfiles,
  readWorkerRegistry,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import { formatDisplayPath } from "../output.js";
import {
  runBenchmarkCapabilityUpdate,
  saveInterviewProfile
} from "./worker-onboarding.js";

type SetupStepStatus =
  | "unavailable"
  | "completed"
  | "dry-run"
  | "needs-input"
  | "skipped";

interface SetupStepResult {
  command?: string;
  details?: Record<string, unknown>;
  id: string;
  path?: string;
  status: SetupStepStatus;
  summary: string;
}

export interface SetupResult {
  minimalSuccessPath: string[];
  mode: "execute" | "dry-run";
  recommendedActions: string[];
  recommendedEntrypoints: Array<{
    command: string;
    description: string;
    toolName?: string;
  }>;
  recommendedEnv: string[];
  rootDir: string;
  status: string;
  steps: SetupStepResult[];
  summary: string;
}

export interface SetupOptions {
  allowWrite: boolean;
  benchmarkWorker: boolean;
  disableValidationAutoDiscover: boolean;
  interviewWorker: boolean;
  lintScript: string[];
  probeWorker: boolean;
  repositoryWriteMode?: "allow-write" | "dry-run";
  root?: string;
  registerWorker: boolean;
  testScript: string[];
  workerApiKey?: string;
  typecheckScript: string[];
  workerBaseUrl?: string;
  workerClientCommand?: string;
  workerId?: string;
  workerModel?: string;
  workerProvider?: string;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const unique = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const relativePath = (rootDir: string, path: string): string =>
  formatDisplayPath(rootDir, path);

const mergeModelConfig = (
  existing: CwConfig["workerModel"],
  updates: {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    provider?: string;
  }
) => {
  const hasUpdate =
    Boolean(updates.apiKey) ||
    Boolean(updates.provider) ||
    Boolean(updates.model) ||
    Boolean(updates.baseURL);

  if (!existing && !hasUpdate) {
    return undefined;
  }

  return {
    ...(existing ?? {}),
    ...(updates.apiKey ? { apiKey: updates.apiKey } : {}),
    ...(updates.provider ? { provider: updates.provider } : {}),
    ...(updates.model ? { model: updates.model } : {}),
    ...(updates.baseURL ? { baseURL: updates.baseURL } : {})
  };
};

const buildDesiredConfig = (
  existing: CwConfig,
  options: SetupOptions
): CwConfig =>
  CwConfigSchema.parse({
    ...existing,
    version: 1,
    ...(options.workerClientCommand
      ? {
          workerClientCommand: options.workerClientCommand
        }
      : {}),
    safety:
      options.repositoryWriteMode === "allow-write"
        ? {
            ...existing.safety,
            dryRun: false,
            allowWrite: true
          }
        : options.repositoryWriteMode === "dry-run"
          ? {
              ...existing.safety,
              dryRun: true,
              allowWrite: false
            }
          : existing.safety,
    workerModel: mergeModelConfig(existing.workerModel, {
      apiKey: options.workerApiKey,
      provider: options.workerProvider,
      model: options.workerModel,
      baseURL: options.workerBaseUrl
    }),
    validation: {
      ...existing.validation,
      autoDiscover: options.disableValidationAutoDiscover
        ? false
        : existing.validation.autoDiscover,
      scripts: {
        typecheck:
          options.typecheckScript.length > 0
            ? unique(options.typecheckScript)
            : existing.validation.scripts.typecheck,
        lint:
          options.lintScript.length > 0
            ? unique(options.lintScript)
            : existing.validation.scripts.lint,
        test:
          options.testScript.length > 0
            ? unique(options.testScript)
            : existing.validation.scripts.test
      }
    }
  });

const writeManagedJson = async (
  context: ExecutionContext,
  path: string,
  value: unknown,
  allowWrite: boolean,
  action: string
): Promise<{ mode: "execute" | "dry-run"; path: string; changed: boolean }> => {
  const evaluation = context.writePolicy.evaluate(path, allowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      path: evaluation.normalizedPath
    });
  }

  const content = JSON.stringify(value, null, 2);
  const alreadyExists = await exists(evaluation.normalizedPath);
  const existingContent = alreadyExists
    ? await readFile(evaluation.normalizedPath, "utf8")
    : null;
  const changed = existingContent !== content;

  if (evaluation.mode === "dry-run") {
    return {
      mode: "dry-run",
      path: evaluation.normalizedPath,
      changed
    };
  }

  if (changed) {
    await mkdir(dirname(evaluation.normalizedPath), { recursive: true });
    await writeFile(evaluation.normalizedPath, content, "utf8");
  }

  await writeAuditEvent(
    context,
    {
      actor: "cli",
      action,
      mode: "execute",
      inputSummary: evaluation.normalizedPath,
      outputSummary: changed
        ? `${action} updated ${evaluation.normalizedPath}.`
        : `${action} left ${evaluation.normalizedPath} unchanged.`,
      warnings: [],
      errors: [],
      metadata: {
        path: evaluation.normalizedPath,
        changed
      }
    },
    true
  );

  return {
    mode: "execute",
    path: evaluation.normalizedPath,
    changed
  };
};

const ensureDirectory = async (
  context: ExecutionContext,
  path: string,
  allowWrite: boolean
): Promise<{ mode: "execute" | "dry-run"; path: string; changed: boolean }> => {
  const evaluation = context.writePolicy.evaluate(path, allowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      path: evaluation.normalizedPath
    });
  }

  const changed = !(await exists(evaluation.normalizedPath));

  if (evaluation.mode === "dry-run") {
    return {
      mode: "dry-run",
      path: evaluation.normalizedPath,
      changed
    };
  }

  if (changed) {
    await mkdir(evaluation.normalizedPath, { recursive: true });
  }

  return {
    mode: "execute",
    path: evaluation.normalizedPath,
    changed
  };
};

const resolveSetupWorkerModel = (
  context: ExecutionContext,
  desiredConfig: CwConfig
): ModelConfig => ({
  ...context.workerModel,
  ...(desiredConfig.workerModel ?? {})
});

const resolveSetupWorkerId = (
  options: SetupOptions,
  modelConfig: ModelConfig
): string => {
  const requiresNamedWorker =
    options.registerWorker ||
    options.probeWorker ||
    options.interviewWorker ||
    options.benchmarkWorker;

  if (requiresNamedWorker && !options.workerId) {
    throw new Error(
      "A user-defined worker id is required before cw can register, probe, interview, or benchmark a worker."
    );
  }

  return options.workerId ?? deriveWorkerRegistrationId(modelConfig);
};

const buildValidationSummary = (options: SetupOptions): string => {
  const mappings = [
    options.typecheckScript.length > 0
      ? `typecheck -> ${options.typecheckScript.join(", ")}`
      : null,
    options.lintScript.length > 0
      ? `lint -> ${options.lintScript.join(", ")}`
      : null,
    options.testScript.length > 0
      ? `test -> ${options.testScript.join(", ")}`
      : null
  ].filter((value): value is string => Boolean(value));

  if (mappings.length === 0 && !options.disableValidationAutoDiscover) {
    return "Validation script mappings were left unchanged.";
  }

  if (mappings.length === 0 && options.disableValidationAutoDiscover) {
    return "Validation auto-discovery will be disabled without adding explicit script mappings.";
  }

  return `Validation mappings prepared: ${mappings.join("; ")}.`;
};

const buildProbeChecks = async (
  context: ExecutionContext,
  workerId: string,
  workerModel: ModelConfig
): Promise<DoctorCheck[]> =>
  createWorkerDoctorChecks({
    ...context,
    defaultWorkerId: workerId,
    workerModel
  }, { probe: true, includeLocalClient: false });

export const formatSetupResult = (result: SetupResult): string[] => {
  const unavailableSteps = result.steps.filter((step) => step.status === "unavailable");
  const needsInputSteps = result.steps.filter((step) => step.status === "needs-input");

  const lines: string[] = [
    `cw init: ${result.status}`,
    result.summary,
    `workspace: ${result.rootDir}`,
    `mode: ${result.mode}`,
    `steps: ${result.steps
      .map((step) => `${step.id}=${step.status}`)
      .join(", ")}`
  ];

  if (unavailableSteps.length > 0) {
    lines.push(
      `unavailable: ${unavailableSteps
        .slice(0, 3)
        .map((step) => step.summary)
        .join(" | ")}`
    );
  }

  if (needsInputSteps.length > 0) {
    lines.push(
      `attention: ${needsInputSteps
        .slice(0, 3)
        .map((step) => step.summary)
        .join(" | ")}`
    );
  }

  if (result.recommendedEnv.length > 0) {
    lines.push(`env: ${result.recommendedEnv.join(", ")}`);
  }

  if (result.recommendedActions.length > 0) {
    lines.push(`next: ${result.recommendedActions.slice(0, 3).join(" | ")}`);
  }

  return lines;
};

const normalizeSetupOptions = async (
  options: SetupOptions
): Promise<SetupOptions> => {
  if (!options.workerClientCommand) {
    return options;
  }

  const normalizedCommand = normalizeCommandInput(options.workerClientCommand);
  const inspection = await inspectLocalClientCommand(normalizedCommand, {
    checkCompatibility: false
  });

  if (inspection.isPathLike && inspection.status !== "pass") {
    throw new Error(inspection.compatibility.message);
  }

  return {
    ...options,
    workerClientCommand: normalizedCommand
  };
};

export const runSetup = async (options: SetupOptions): Promise<SetupResult> => {
  const normalizedOptions = await normalizeSetupOptions(options);
  const context = await resolveExecutionContext({
    rootDir: normalizedOptions.root,
    cliOverrides: {
      allowWrite: normalizedOptions.allowWrite,
      dryRun: !normalizedOptions.allowWrite
    }
  });
  const steps: SetupStepResult[] = [];
  const configResult = await loadCwConfig(context.rootDir);
  const desiredConfig = buildDesiredConfig(configResult.config, normalizedOptions);
  const setupWorkerModel = resolveSetupWorkerModel(context, desiredConfig);
  const setupWorkerId = resolveSetupWorkerId(normalizedOptions, setupWorkerModel);
  const configToWrite = normalizedOptions.registerWorker
    ? CwConfigSchema.parse({
        ...desiredConfig,
        defaultWorkerId: setupWorkerId
      })
    : desiredConfig;
  const registryState = await readWorkerRegistry(
    context.rootDir,
    context.cwStorageDir
  );
  const profileState = await readPersistedWorkerProfiles(
    context.rootDir,
    context.cwStorageDir
  );
  const cwDir = context.cwStorageDir;
  const auditDir = getCwWorkspaceAuditDirFromStorageDir(cwDir);
  const runsDir = getCwWorkspaceRunsDirFromStorageDir(cwDir);
  const configPath = getCwConfigPath(context.rootDir);
  const registryPath = getWorkerRegistryPath(
    context.rootDir,
    context.cwStorageDir
  );
  const profilesPath = getWorkerProfileStorePath(
    context.rootDir,
    context.cwStorageDir
  );

  const cwDirResult = await ensureDirectory(context, cwDir, normalizedOptions.allowWrite);
  const auditDirResult = await ensureDirectory(context, auditDir, normalizedOptions.allowWrite);
  const runsDirResult = await ensureDirectory(context, runsDir, normalizedOptions.allowWrite);

  steps.push({
    id: "workspace-scaffold",
    status: normalizedOptions.allowWrite ? "completed" : "dry-run",
    summary: normalizedOptions.allowWrite
      ? "Ensured user-scoped cw workspace directories exist for audit logs and task runs."
      : "Would ensure user-scoped cw workspace directories exist for audit logs and task runs.",
    details: {
      cwDir: relativePath(context.rootDir, cwDirResult.path),
      auditDir: relativePath(context.rootDir, auditDirResult.path),
      runsDir: relativePath(context.rootDir, runsDirResult.path)
    }
  });

  const configWrite = await writeManagedJson(
    context,
    configPath,
    configToWrite,
    normalizedOptions.allowWrite,
    "setup-write-config"
  );
  steps.push({
    id: "configure-models",
    status: configWrite.mode === "execute" ? "completed" : "dry-run",
    path: relativePath(context.rootDir, configWrite.path),
    summary:
      configWrite.changed
        ? configWrite.mode === "execute"
          ? "Updated the cw workspace config with the requested worker, validation, and safety settings."
          : "Would update the cw workspace config with the requested worker, validation, and safety settings."
        : "The cw workspace config already matches the requested worker, validation, and safety settings.",
    details: {
      replacedInvalidConfig: Boolean(configResult.error),
      defaultWorkerId: configToWrite.defaultWorkerId,
      safety: configToWrite.safety,
      workerClientCommand: configToWrite.workerClientCommand,
      workerModel: configToWrite.workerModel
    }
  });

  if (registryState.error) {
    steps.push({
      id: "worker-registry-store",
      status: "unavailable",
      path: relativePath(context.rootDir, registryPath),
      summary:
        "Existing worker registry is invalid. Fix or replace it before setup can manage worker registrations safely.",
      command: "cw doctor",
      details: {
        error: registryState.error
      }
    });
  } else {
    const registryWrite = await writeManagedJson(
      context,
      registryPath,
      {
        version: 1,
        workers: registryState.workers
      },
      normalizedOptions.allowWrite,
      "setup-write-worker-registry"
    );
    steps.push({
      id: "worker-registry-store",
      status: registryWrite.mode === "execute" ? "completed" : "dry-run",
      path: relativePath(context.rootDir, registryWrite.path),
      summary:
        registryState.exists
          ? "Worker registry store is ready."
          : registryWrite.mode === "execute"
            ? "Created an empty worker registry store."
            : "Would create an empty worker registry store.",
      details: {
        workerCount: registryState.workers.length
      }
    });
  }

  if (profileState.error) {
    steps.push({
      id: "worker-profile-store",
      status: "unavailable",
      path: relativePath(context.rootDir, profilesPath),
      summary:
        "Existing worker profile store is invalid. Fix it before setup tries to persist interviewed profiles.",
      command: "cw doctor",
      details: {
        error: profileState.error
      }
    });
  } else {
    const profileWrite = await writeManagedJson(
      context,
      profilesPath,
      profileState.profiles,
      normalizedOptions.allowWrite,
      "setup-write-worker-profiles"
    );
    steps.push({
      id: "worker-profile-store",
      status: profileWrite.mode === "execute" ? "completed" : "dry-run",
      path: relativePath(context.rootDir, profileWrite.path),
      summary:
        profileState.exists
          ? "Worker profile store is ready."
          : profileWrite.mode === "execute"
            ? "Created an empty worker profile store."
            : "Would create an empty worker profile store.",
      details: {
        profileCount: profileState.profiles.length
      }
    });
  }

  steps.push({
    id: "map-validation",
    status:
      normalizedOptions.allowWrite &&
      (normalizedOptions.typecheckScript.length > 0 ||
        normalizedOptions.lintScript.length > 0 ||
        normalizedOptions.testScript.length > 0 ||
        normalizedOptions.disableValidationAutoDiscover)
        ? "completed"
        : normalizedOptions.typecheckScript.length > 0 ||
            normalizedOptions.lintScript.length > 0 ||
            normalizedOptions.testScript.length > 0 ||
            normalizedOptions.disableValidationAutoDiscover
          ? "dry-run"
          : "skipped",
    command: "cw doctor",
    summary: buildValidationSummary(normalizedOptions),
    details: {
      validation: configToWrite.validation
    }
  });

  const workerModel = resolveSetupWorkerModel(context, configToWrite);
  const workerId = resolveSetupWorkerId(normalizedOptions, workerModel);
  let probeChecks: DoctorCheck[] = [];
  let interviewedProfile:
    | Awaited<ReturnType<typeof runWorkerInterviewWorkflow>>["profile"]
    | null = null;
  let interviewPersisted = false;

  if (normalizedOptions.registerWorker) {
    if (registryState.error) {
      steps.push({
        id: "register-worker",
        status: "unavailable",
        summary:
          "Worker registration was requested, but the registry store is invalid.",
        command: "cw doctor"
      });
    } else {
      const registrationResult = await saveWorkerRegistration(
        context,
        {
          workerId,
          provider: workerModel.provider,
          model: workerModel.model,
          baseURL: workerModel.baseURL,
          enabled: true,
          tags: ["setup"],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        normalizedOptions.allowWrite
      );
      steps.push({
        id: "register-worker",
        status: registrationResult.mode === "execute" ? "completed" : "dry-run",
        path: relativePath(context.rootDir, registrationResult.path),
        summary:
          registrationResult.mode === "execute"
            ? `Registered worker ${workerId}.`
            : `Would register worker ${workerId}.`,
        command: "cw worker registry list",
        details: {
          workerId,
          provider: workerModel.provider,
          model: workerModel.model
        }
      });
    }
  } else {
    steps.push({
      id: "register-worker",
      status: "skipped",
      summary:
        "Worker registration was skipped. This is fine unless you want explicit worker routing beyond the default worker.",
      command:
        "cw worker register --provider <provider> --model <model> --allow-write"
    });
  }

  if (normalizedOptions.probeWorker) {
    if (!normalizedOptions.registerWorker) {
      steps.push({
        id: "probe-worker",
        status: "unavailable",
        summary:
          "Worker probe was requested, but worker registration is disabled for this setup run.",
        command: "cw init"
      });
    } else {
      probeChecks = await buildProbeChecks(context, workerId, workerModel);
      const probeCheck = probeChecks[0];

      steps.push({
        id: "probe-worker",
        status: probeCheck?.status === "pass" ? "completed" : "unavailable",
        summary:
          probeCheck?.message ??
          `Worker ${workerId} probe did not produce a connectivity result.`,
        command: "cw doctor --probe",
        details: probeCheck?.metadata
      });
    }
  } else {
    steps.push({
      id: "probe-worker",
      status: "skipped",
      summary:
        "Worker probe was skipped. Run `cw doctor --probe` later if you want a live connectivity check.",
      command: "cw doctor --probe"
    });
  }

  if (normalizedOptions.interviewWorker) {
    if (profileState.error) {
      steps.push({
        id: "interview-worker",
        status: "unavailable",
        summary:
          "Worker interview was requested, but the profile store is invalid.",
        command: "cw doctor"
      });
    } else {
      const interviewResult = await runWorkerInterviewWorkflow({
        context,
        workerId,
        modelConfig: workerModel
      });

      const interviewSave = await saveInterviewProfile({
        context,
        profile: interviewResult.profile,
        save: normalizedOptions.allowWrite,
        persistenceAdvice: interviewResult.persistenceAdvice
      });

      if (interviewSave?.mode === "skipped") {
        steps.push({
          id: "interview-worker",
          status: "unavailable",
          summary: interviewSave.reason ?? interviewResult.persistenceAdvice.reason,
          command: "cw worker interview --save",
          details: {
            recommendedActions:
              interviewSave.recommendedActions ??
              interviewResult.persistenceAdvice.recommendedActions,
            warnings: interviewResult.warnings
          }
        });
      } else if (interviewSave.mode === "dry-run") {
        steps.push({
          id: "interview-worker",
          status: "dry-run",
          path: relativePath(context.rootDir, profilesPath),
          summary:
            `Would persist interviewed worker profile ${workerId} after rerunning with --allow-write.`,
          command: "cw worker interview --save",
          details: {
            workerId,
            profileStatus: interviewResult.profile.status,
            supportedTaskTypes: interviewResult.profile.supportedTaskTypes
          }
        });
        interviewedProfile = interviewResult.profile;
      } else {
        interviewedProfile = interviewResult.profile;
        interviewPersisted = true;
        steps.push({
          id: "interview-worker",
          status: "completed",
          path: relativePath(context.rootDir, interviewSave.path ?? profilesPath),
          summary: `Interviewed and persisted worker profile ${workerId}.`,
          command: "cw worker profile",
          details: {
            workerId,
            profileStatus: interviewResult.profile.status,
            supportedTaskTypes: interviewResult.profile.supportedTaskTypes
          }
        });
      }
    }
  } else {
    steps.push({
      id: "interview-worker",
      status: "skipped",
      summary:
        "Worker interview was skipped. Run it when you want persisted routing confidence instead of default fallback behavior.",
      command: "cw worker interview --save"
    });
  }

  if (normalizedOptions.benchmarkWorker) {
    if (!normalizedOptions.interviewWorker) {
      steps.push({
        id: "benchmark-worker",
        status: "unavailable",
        summary:
          "Worker benchmark requires an interviewed worker profile. Enable interview before benchmarking.",
        command: "cw worker interview --save"
      });
    } else if (!interviewedProfile) {
      steps.push({
        id: "benchmark-worker",
        status: "unavailable",
        summary:
          "Worker benchmark could not run because the interview did not produce a usable profile.",
        command: "cw worker interview --save"
      });
    } else if (!interviewPersisted) {
      steps.push({
        id: "benchmark-worker",
        status: normalizedOptions.allowWrite ? "unavailable" : "dry-run",
        summary: normalizedOptions.allowWrite
          ? "Worker benchmark was skipped because the interviewed profile was not persisted."
          : "Would benchmark the worker after rerunning with --allow-write so the interviewed profile can be persisted first.",
        command: "cw worker benchmark --suite coding-v1 --save --update-profile-capabilities"
      });
    } else {
      const benchmarkUpdate = await runBenchmarkCapabilityUpdate({
        context,
        modelConfig: workerModel,
        save: true,
        updateProfileCapabilities: true,
        workerId
      });

      steps.push({
        id: "benchmark-worker",
        status: "completed",
        path: relativePath(
          context.rootDir,
          benchmarkUpdate.persistence?.path ?? ""
        ),
        summary: `Benchmarked worker ${workerId} and refreshed persisted capability routing.`,
        command: "cw worker benchmark --suite coding-v1 --save --update-profile-capabilities",
        details: {
          artifactPath: relativePath(
            context.rootDir,
            benchmarkUpdate.persistence?.path ?? ""
          ),
          capabilityStatus: benchmarkUpdate.profileUpdate?.patchGenerationQualified
            ? "qualified"
            : "not-qualified",
          profilePath: relativePath(
            context.rootDir,
            benchmarkUpdate.profilePersistence?.path ?? ""
          ),
          suiteName: benchmarkUpdate.benchmarkResult.suiteName,
          workerId
        }
      });
    }
  } else {
    steps.push({
      id: "benchmark-worker",
      status: "skipped",
      summary:
        "Worker benchmark was skipped. Run it later after interview if you want capability qualification evidence.",
      command: "cw worker benchmark --suite coding-v1 --save --update-profile-capabilities"
    });
  }

  const finalContext = await resolveExecutionContext({
    rootDir: context.rootDir
  });
  const finalDoctor = await runDoctor(finalContext, {
    additionalChecks: [
      ...(await createWorkerDoctorChecks(finalContext, { includeLocalClient: false })),
      ...probeChecks
    ]
  });
  const readinessSummary: string = finalDoctor.summary;
  const readinessCapabilities: SetupStepResult["details"] = {
    capabilities: finalDoctor.capabilities
  };
  const resultStatus: SetupResult["status"] = finalDoctor.status;
  const minimalSuccessPath: SetupResult["minimalSuccessPath"] = [
    ...finalDoctor.minimalSuccessPath
  ];
  const recommendedEntrypoints: SetupResult["recommendedEntrypoints"] = [
    ...finalDoctor.recommendedEntrypoints
  ];

  steps.push({
    id: "readiness-summary",
    status: finalDoctor.status === "ready" ? "completed" : "unavailable",
    command: "cw doctor",
    summary: readinessSummary,
    details: readinessCapabilities
  });

  return {
    mode: normalizedOptions.allowWrite ? "execute" : "dry-run",
    rootDir: context.rootDir,
    status: resultStatus,
    summary: readinessSummary,
    steps,
    recommendedEnv: unique([
      configToWrite.workerModel &&
      !configToWrite.workerModel.apiKey &&
      !["mock", "client"].includes(
        configToWrite.workerModel.provider
      )
        ? "WORKER_MODEL_API_KEY"
        : undefined
    ]).map((name) => `export ${name}=...`),
    minimalSuccessPath,
    recommendedEntrypoints,
    recommendedActions: finalDoctor.recommendedActions.slice(0, 6)
  };
};
