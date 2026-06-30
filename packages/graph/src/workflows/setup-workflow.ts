import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";

import {
  AgentError,
  type AvailabilityStatus,
  CwConfigSchema,
  createExecutionContextWithWorkerModel,
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
  buildWorkerAvailabilitySnapshot,
  createWorkerDoctorChecks,
  finalizeDoctorReport,
  getWorkerProfileStorePath,
  getWorkerRegistryPath,
  getWorkerRegistration,
  inspectLocalClientCommand,
  readPersistedWorkerProfiles,
  readWorkerRegistry,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import {
  runWorkerBenchmarkOnboarding,
  runWorkerInterviewOnboarding
} from "./worker-onboarding-workflow.js";

export type SetupStepStatus =
  | "unavailable"
  | "completed"
  | "dry-run"
  | "needs-input"
  | "skipped";

export interface SetupStepResult {
  command?: string;
  details?: Record<string, unknown>;
  id: string;
  path?: string;
  status: SetupStepStatus;
  summary: string;
}

export interface SetupWorkerPlan {
  apiKey?: string;
  baseUrl?: string;
  benchmarkWorker: boolean;
  clientCommand?: string;
  interviewWorker: boolean;
  isDefault: boolean;
  probeWorker: boolean;
  registerWorker: boolean;
  workerId: string;
  workerMode?: "api" | "client";
  workerModel: string;
  workerProvider: string;
}

export interface SetupWorkerSummary {
  benchmarkStatus?: SetupStepStatus;
  benchmarkWorker: boolean;
  configured: boolean;
  interviewWorker: boolean;
  interviewStatus?: SetupStepStatus;
  isDefault: boolean;
  probeStatus?: SetupStepStatus;
  probeWorker: boolean;
  readinessStatus?:
    | Awaited<ReturnType<typeof buildWorkerAvailabilitySnapshot>>["status"]
    | "dry-run"
    | "skipped";
  readinessUnavailableReasonType?: Awaited<
    ReturnType<typeof buildWorkerAvailabilitySnapshot>
  >["unavailableReasonType"];
  registerWorker: boolean;
  registerStatus?: SetupStepStatus;
  workerId: string;
  workerMode?: "api" | "client";
  workerModel: string;
  workerProvider: string;
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
  recommendedConfig: string[];
  readiness: Awaited<ReturnType<typeof buildWorkerAvailabilitySnapshot>> | null;
  rootDir: string;
  status: AvailabilityStatus;
  steps: SetupStepResult[];
  summary: string;
  workers: SetupWorkerSummary[];
}

export interface SetupOptions {
  additionalWorkers?: SetupWorkerPlan[];
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

const formatWorkflowPath = (rootDir: string, path: string): string => {
  const candidate = relative(rootDir, path);

  if (candidate.length === 0) {
    return ".";
  }

  return !candidate.startsWith("..") && !isAbsolute(candidate)
    ? candidate
    : path;
};

const relativePath = (rootDir: string, path: string): string =>
  formatWorkflowPath(rootDir, path);

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
      actor: "workflow",
      action,
      mode: "execute",
      workflow: "setup-workflow",
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
  ...(desiredConfig.workerClientCommand
    ? {
        clientCommand: desiredConfig.workerClientCommand
      }
    : {}),
  ...(desiredConfig.workerModel ?? {})
});

const resolveWorkerMode = (provider: string): "api" | "client" =>
  ["client", "opencode", "claudecode", "codex"].includes(provider) ? "client" : "api";

const buildPrimaryWorkerPlan = (
  options: SetupOptions,
  modelConfig: ModelConfig
): SetupWorkerPlan | null => {
  const requiresNamedWorkerWorkflow =
    options.registerWorker ||
    options.probeWorker ||
    options.interviewWorker ||
    options.benchmarkWorker;

  if (!requiresNamedWorkerWorkflow && !options.workerId) {
    return null;
  }

  if (!options.workerId) {
    throw new Error(
      "A user-defined worker id is required before cw can register, probe, interview, or benchmark a worker."
    );
  }

  return {
    apiKey: options.workerApiKey,
    baseUrl: options.workerBaseUrl,
    benchmarkWorker: options.benchmarkWorker,
    clientCommand: modelConfig.clientCommand,
    interviewWorker: options.interviewWorker,
    isDefault: true,
    probeWorker: options.probeWorker,
    registerWorker: options.registerWorker,
    workerId: options.workerId,
    workerMode: resolveWorkerMode(modelConfig.provider),
    workerModel: modelConfig.model,
    workerProvider: modelConfig.provider
  };
};

const buildSetupWorkerPlans = (
  options: SetupOptions,
  primaryWorkerModel: ModelConfig
): SetupWorkerPlan[] => {
  const plans: SetupWorkerPlan[] = [];
  const primary = buildPrimaryWorkerPlan(options, primaryWorkerModel);

  if (primary) {
    plans.push(primary);
  }

  const seenWorkerIds = new Set(plans.map((plan) => plan.workerId));

  for (const worker of options.additionalWorkers ?? []) {
    if (seenWorkerIds.has(worker.workerId)) {
      throw new Error(
        `Worker id '${worker.workerId}' was provided more than once in setup. Use unique worker ids.`
      );
    }

    seenWorkerIds.add(worker.workerId);
    plans.push({
      ...worker,
      workerMode: worker.workerMode ?? resolveWorkerMode(worker.workerProvider)
    });
  }

  return plans;
};

const buildWorkerStepId = (baseId: string, plan: SetupWorkerPlan): string =>
  plan.isDefault ? baseId : `${baseId}:${plan.workerId}`;

const buildPlannedWorkerModel = (
  context: ExecutionContext,
  plan: SetupWorkerPlan
): ModelConfig => ({
  ...context.workerModel,
  provider: plan.workerProvider,
  model: plan.workerModel,
  ...(plan.clientCommand ? { clientCommand: plan.clientCommand } : {}),
  ...(plan.baseUrl ? { baseURL: plan.baseUrl } : {}),
  ...(plan.apiKey ? { apiKey: plan.apiKey } : {})
});

const createWorkerSummary = (plan: SetupWorkerPlan): SetupWorkerSummary => ({
  benchmarkWorker: plan.benchmarkWorker,
  configured: true,
  interviewWorker: plan.interviewWorker,
  isDefault: plan.isDefault,
  probeWorker: plan.probeWorker,
  registerWorker: plan.registerWorker,
  workerId: plan.workerId,
  workerMode: plan.workerMode,
  workerModel: plan.workerModel,
  workerProvider: plan.workerProvider
});

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
  createWorkerDoctorChecks(
    {
      ...context,
      workerModel
    },
    {
      probe: true,
      includeLocalClient: false,
      workerId
    }
  );

const runSetupWorkerPlan = async (input: {
  allowWrite: boolean;
  context: ExecutionContext;
  plan: SetupWorkerPlan;
  profileStoreError: string | undefined;
  profileStorePath: string;
  registryStoreError: string | undefined;
}): Promise<{
  probeChecks: DoctorCheck[];
  steps: SetupStepResult[];
  summary: SetupWorkerSummary;
}> => {
  const workerModel = buildPlannedWorkerModel(input.context, input.plan);
  const steps: SetupStepResult[] = [];
  const summary = createWorkerSummary(input.plan);
  const existingRegistration = input.registryStoreError
    ? null
    : await getWorkerRegistration(
        input.context.rootDir,
        input.plan.workerId,
        input.context.cwStorageDir
      );
  let probeChecks: DoctorCheck[] = [];
  let interviewedProfile:
    | Awaited<ReturnType<typeof runWorkerInterviewOnboarding>>["profile"]
    | null = null;
  let interviewPersisted = false;
  const registrationAvailable =
    Boolean(existingRegistration) || input.plan.registerWorker;

  if (input.plan.registerWorker) {
    if (input.registryStoreError) {
      summary.registerStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("register-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker registration was requested, but the registry store is invalid.",
        command: "cw doctor"
      });
    } else {
      const now = new Date().toISOString();
      const registrationResult = await saveWorkerRegistration(
        input.context,
        {
          workerId: input.plan.workerId,
          provider: workerModel.provider,
          model: workerModel.model,
          baseURL: workerModel.baseURL,
          enabled: true,
          tags: input.plan.isDefault ? ["setup"] : ["setup", "init"],
          createdAt: existingRegistration?.createdAt ?? now,
          updatedAt: now
        },
        input.allowWrite
      );
      summary.registerStatus =
        registrationResult.mode === "execute" ? "completed" : "dry-run";
      steps.push({
        id: buildWorkerStepId("register-worker", input.plan),
        status: summary.registerStatus,
        path: relativePath(input.context.rootDir, registrationResult.path),
        summary:
          registrationResult.mode === "execute"
            ? `Registered worker ${input.plan.workerId}.`
            : `Would register worker ${input.plan.workerId}.`,
        command: "cw worker registry list",
        details: {
          workerId: input.plan.workerId,
          provider: workerModel.provider,
          model: workerModel.model
        }
      });
    }
  } else {
    summary.registerStatus = existingRegistration ? "completed" : "skipped";
    steps.push({
      id: buildWorkerStepId("register-worker", input.plan),
      status: existingRegistration ? "completed" : "skipped",
      summary: existingRegistration
        ? `Worker ${input.plan.workerId} is already registered.`
        : "Worker registration was skipped.",
      command:
        existingRegistration
          ? "cw worker registry list"
          : `cw worker register --worker ${input.plan.workerId} --provider <provider> --model <model> --allow-write`
    });
  }

  if (input.plan.probeWorker) {
    if (!registrationAvailable) {
      summary.probeStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("probe-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker probe requires a registered named worker. Register the worker before probing.",
        command: `cw worker register --worker ${input.plan.workerId} --provider <provider> --model <model> --allow-write`
      });
    } else {
      probeChecks = await buildProbeChecks(
        input.context,
        input.plan.workerId,
        workerModel
      );
      const probeCheck = probeChecks[0];
      summary.probeStatus =
        probeCheck?.status === "pass" ? "completed" : "unavailable";
      steps.push({
        id: buildWorkerStepId("probe-worker", input.plan),
        status: summary.probeStatus,
        summary:
          probeCheck?.message ??
          `Worker ${input.plan.workerId} probe did not produce a connectivity result.`,
        command: `cw worker readiness --worker ${input.plan.workerId} --probe`,
        details: probeCheck?.metadata
      });
    }
  } else {
    summary.probeStatus = "skipped";
    steps.push({
      id: buildWorkerStepId("probe-worker", input.plan),
      status: "skipped",
      summary:
        "Worker probe was skipped. Run a live readiness probe later if needed.",
      command: `cw worker readiness --worker ${input.plan.workerId} --probe`
    });
  }

  if (input.plan.interviewWorker) {
    if (input.profileStoreError) {
      summary.interviewStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("interview-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker interview was requested, but the profile store is invalid.",
        command: "cw doctor"
      });
    } else if (!registrationAvailable) {
      summary.interviewStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("interview-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker interview now requires a registered named worker. Register the worker before interviewing.",
        command: `cw worker register --worker ${input.plan.workerId} --provider <provider> --model <model> --allow-write`
      });
    } else {
      const interviewResult = await runWorkerInterviewOnboarding({
        persistProfile: input.allowWrite,
        context: input.context,
        workerId: input.plan.workerId
      });
      const interviewSave = interviewResult.persistence;

      if (interviewSave?.mode === "skipped") {
        summary.interviewStatus = "unavailable";
        steps.push({
          id: buildWorkerStepId("interview-worker", input.plan),
          status: "unavailable",
          summary: interviewSave.reason ?? interviewResult.persistenceAdvice.reason,
          command: `cw worker interview --worker ${input.plan.workerId} --save`,
          details: {
            recommendedActions:
              interviewSave.recommendedActions ??
              interviewResult.persistenceAdvice.recommendedActions,
            warnings: interviewResult.warnings
          }
        });
      } else if (!input.allowWrite) {
        interviewedProfile = interviewResult.profile;
        summary.interviewStatus = "dry-run";
        steps.push({
          id: buildWorkerStepId("interview-worker", input.plan),
          status: "dry-run",
          path: relativePath(input.context.rootDir, input.profileStorePath),
          summary:
            `Would persist interviewed worker profile ${input.plan.workerId} after rerunning with --allow-write.`,
          command: `cw worker interview --worker ${input.plan.workerId} --save`,
          details: {
            workerId: input.plan.workerId,
            profileStatus: interviewResult.profile.status,
            supportedTaskTypes: interviewResult.profile.supportedTaskTypes
          }
        });
      } else {
        interviewedProfile = interviewResult.profile;
        interviewPersisted = true;
        summary.interviewStatus = "completed";
        steps.push({
          id: buildWorkerStepId("interview-worker", input.plan),
          status: "completed",
          path: relativePath(
            input.context.rootDir,
            interviewSave?.path ?? input.profileStorePath
          ),
          summary: `Interviewed and persisted worker profile ${input.plan.workerId}.`,
          command: `cw worker profile ${input.plan.workerId}`,
          details: {
            workerId: input.plan.workerId,
            profileStatus: interviewResult.profile.status,
            supportedTaskTypes: interviewResult.profile.supportedTaskTypes
          }
        });
      }
    }
  } else {
    summary.interviewStatus = "skipped";
    steps.push({
      id: buildWorkerStepId("interview-worker", input.plan),
      status: "skipped",
      summary:
        "Worker interview was skipped. Run it later when you want persisted routing evidence.",
      command: `cw worker interview --worker ${input.plan.workerId} --save`
    });
  }

  if (input.plan.benchmarkWorker) {
    if (!input.plan.interviewWorker) {
      summary.benchmarkStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("benchmark-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker benchmark requires an interviewed worker profile. Enable interview before benchmarking.",
        command: `cw worker interview --worker ${input.plan.workerId} --save`
      });
    } else if (!interviewedProfile) {
      summary.benchmarkStatus = "unavailable";
      steps.push({
        id: buildWorkerStepId("benchmark-worker", input.plan),
        status: "unavailable",
        summary:
          "Worker benchmark could not run because the interview did not produce a usable profile.",
        command: `cw worker interview --worker ${input.plan.workerId} --save`
      });
    } else if (!interviewPersisted) {
      summary.benchmarkStatus = input.allowWrite ? "unavailable" : "dry-run";
      steps.push({
        id: buildWorkerStepId("benchmark-worker", input.plan),
        status: summary.benchmarkStatus,
        summary: input.allowWrite
          ? "Worker benchmark was skipped because the interviewed profile was not persisted."
          : "Would benchmark the worker after rerunning with --allow-write so the interviewed profile can be persisted first.",
        command:
          `cw worker benchmark --worker ${input.plan.workerId} --suite coding-v1 --save --update-profile-capabilities`
      });
    } else {
      const benchmarkUpdate = await runWorkerBenchmarkOnboarding({
        context: input.context,
        persistArtifact: true,
        updateProfileCapabilities: true,
        workerId: input.plan.workerId
      });
      summary.benchmarkStatus = "completed";
      steps.push({
        id: buildWorkerStepId("benchmark-worker", input.plan),
        status: "completed",
        path: relativePath(
          input.context.rootDir,
          benchmarkUpdate.persistence?.path ?? ""
        ),
        summary: `Benchmarked worker ${input.plan.workerId} and refreshed persisted capability routing.`,
        command:
          `cw worker benchmark --worker ${input.plan.workerId} --suite coding-v1 --save --update-profile-capabilities`,
        details: {
          artifactPath: relativePath(
            input.context.rootDir,
            benchmarkUpdate.persistence?.path ?? ""
          ),
          capabilityStatus: benchmarkUpdate.profileUpdate?.patchGenerationQualified
            ? "qualified"
            : "not-qualified",
          profilePath: relativePath(
            input.context.rootDir,
            benchmarkUpdate.profilePersistence?.path ?? ""
          ),
          suiteName: benchmarkUpdate.benchmarkResult.suiteName,
          workerId: input.plan.workerId
        }
      });
    }
  } else {
    summary.benchmarkStatus = "skipped";
    steps.push({
      id: buildWorkerStepId("benchmark-worker", input.plan),
      status: "skipped",
      summary:
        "Worker benchmark was skipped. Run it later after interview if you want capability qualification evidence.",
      command:
        `cw worker benchmark --worker ${input.plan.workerId} --suite coding-v1 --save --update-profile-capabilities`
    });
  }

  return {
    probeChecks,
    steps,
    summary
  };
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
  const primaryWorkerModel = resolveSetupWorkerModel(context, desiredConfig);
  const workerPlans = buildSetupWorkerPlans(normalizedOptions, primaryWorkerModel);
  const configToWrite = desiredConfig;
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

  const workerSummaries: SetupWorkerSummary[] = [];
  let probeChecks: DoctorCheck[] = [];

  for (const plan of workerPlans) {
    const workerResult = await runSetupWorkerPlan({
      allowWrite: normalizedOptions.allowWrite,
      context,
      plan,
      profileStoreError: profileState.error,
      profileStorePath: profilesPath,
      registryStoreError: registryState.error
    });
    probeChecks = [...probeChecks, ...workerResult.probeChecks];
    workerSummaries.push(workerResult.summary);
    steps.push(...workerResult.steps);
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
  const readinessWorkerPlan =
    workerPlans.find((plan) => plan.isDefault) ?? workerPlans[0];

  for (const summary of workerSummaries) {
    const plan = workerPlans.find((candidate) => candidate.workerId === summary.workerId);

    if (!plan) {
      continue;
    }

    if (!normalizedOptions.allowWrite) {
      summary.readinessStatus =
        plan.registerWorker ||
        plan.probeWorker ||
        plan.interviewWorker ||
        plan.benchmarkWorker
          ? "dry-run"
          : "skipped";
      continue;
    }

    const readinessContext = createExecutionContextWithWorkerModel(
      finalContext,
      buildPlannedWorkerModel(finalContext, plan)
    );
    const workerReadiness = await buildWorkerAvailabilitySnapshot({
      context: readinessContext,
      probe: plan.probeWorker,
      workerId: plan.workerId
    });
    summary.readinessStatus = workerReadiness.status;
    summary.readinessUnavailableReasonType =
      workerReadiness.unavailableReasonType;
  }

  const readiness = readinessWorkerPlan
    ? await buildWorkerAvailabilitySnapshot({
        context: createExecutionContextWithWorkerModel(
          finalContext,
          buildPlannedWorkerModel(finalContext, readinessWorkerPlan)
        ),
        probe: readinessWorkerPlan.probeWorker,
        workerId: readinessWorkerPlan.workerId
      })
    : null;
  const finalDoctorWithReadiness = readiness
    ? finalizeDoctorReport({
        report: finalDoctor,
        workerAvailability: readiness
      })
    : finalDoctor;
  const readinessSummary: string = finalDoctorWithReadiness.summary;
  const readinessCapabilities: SetupStepResult["details"] = {
    capabilities: finalDoctorWithReadiness.capabilities,
    workerAvailability: finalDoctorWithReadiness.workerAvailability
  };
  const resultStatus: SetupResult["status"] = finalDoctorWithReadiness.status;
  const minimalSuccessPath: SetupResult["minimalSuccessPath"] = [
    ...finalDoctorWithReadiness.minimalSuccessPath
  ];
  const recommendedEntrypoints: SetupResult["recommendedEntrypoints"] = [
    ...finalDoctorWithReadiness.recommendedEntrypoints
  ];

  steps.push({
    id: "readiness-summary",
    status:
      finalDoctorWithReadiness.status === "ready"
        ? "completed"
        : "unavailable",
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
    recommendedConfig: unique([
      configToWrite.workerModel &&
      !configToWrite.workerModel.apiKey &&
      !["mock", "client", "opencode", "claudecode", "codex"].includes(
        configToWrite.workerModel.provider
      )
        ? "Persist workerModel.apiKey in config.json before running the worker."
        : undefined
    ]),
    minimalSuccessPath,
    recommendedEntrypoints,
    recommendedActions: unique([
      ...finalDoctorWithReadiness.recommendedActions
    ]).slice(0, 6),
    readiness,
    workers: workerSummaries
  };
};
