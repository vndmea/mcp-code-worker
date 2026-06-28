import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Command } from "commander";

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
  type ModelConfig
} from "@mcp-code-worker/core";
import { runWorkerInterviewWorkflow } from "@mcp-code-worker/graph";
import {
  createWorkerProfileDoctorChecks,
  deriveWorkerRegistrationId,
  getWorkerProfileStorePath,
  getWorkerRegistryPath,
  inspectLocalClientCommand,
  readPersistedWorkerProfiles,
  readWorkerRegistry,
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { formatDisplayPath, writeOutput } from "../output.js";

type SetupStepStatus =
  | "blocked"
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
  disableValidationAutoDiscover: boolean;
  interviewWorker: boolean;
  lintScript: string[];
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

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value
];

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
): string => options.workerId ?? deriveWorkerRegistrationId(modelConfig);

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

const formatSetupResult = (result: SetupResult): string[] => {
  const blockedSteps = result.steps.filter((step) => step.status === "blocked");
  const needsInputSteps = result.steps.filter((step) => step.status === "needs-input");

  const lines: string[] = [
    `cw setup: ${result.status}`,
    result.summary,
    `workspace: ${result.rootDir}`,
    `mode: ${result.mode}`,
    `steps: ${result.steps
      .map((step) => `${step.id}=${step.status}`)
      .join(", ")}`
  ];

  if (blockedSteps.length > 0) {
    lines.push(
      `blocking: ${blockedSteps
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
      status: "blocked",
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
      status: "blocked",
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

  if (normalizedOptions.registerWorker) {
    if (registryState.error) {
      steps.push({
        id: "register-worker",
        status: "blocked",
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

  if (normalizedOptions.interviewWorker) {
    if (profileState.error) {
      steps.push({
        id: "interview-worker",
        status: "blocked",
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

      if (!interviewResult.persistenceAdvice.canPersist) {
        steps.push({
          id: "interview-worker",
          status: "blocked",
          summary: interviewResult.persistenceAdvice.reason,
          command: "cw worker interview --save",
          details: {
            recommendedActions:
              interviewResult.persistenceAdvice.recommendedActions,
            warnings: interviewResult.warnings
          }
        });
      } else if (normalizedOptions.allowWrite) {
        const profileSave = await saveWorkerProfile(
          context,
          interviewResult.profile,
          true
        );
        steps.push({
          id: "interview-worker",
          status: "completed",
          path: relativePath(context.rootDir, profileSave.path),
          summary: `Interviewed and persisted worker profile ${workerId}.`,
          command: "cw worker profile",
          details: {
            workerId,
            profileStatus: interviewResult.profile.status,
            supportedTaskTypes: interviewResult.profile.supportedTaskTypes
          }
        });
      } else {
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

  const finalContext = await resolveExecutionContext({
    rootDir: context.rootDir
  });
  const finalDoctor = await runDoctor(finalContext, {
    additionalChecks: await createWorkerProfileDoctorChecks(finalContext)
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
    status:
      finalDoctor.status === "ready"
        ? "completed"
        : finalDoctor.status === "degraded"
          ? "needs-input"
          : "blocked",
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
      !["mock", "client", "local-client"].includes(
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

export const registerSetupCommand = (program: Command, io: CliIo): void => {
  program
    .command("setup")
    .description("Guide and optionally apply the user-scoped setup steps needed before cw task workflows feel reliable.")
    .option("--root <path>", "Resolve and persist setup state for this workspace root.")
    .option("--worker-provider <provider>", "Worker provider")
    .option("--worker-model <model>", "Worker model")
    .option("--worker-base-url <url>", "Worker base URL")
    .option("--worker-api-key <key>", "Persist a worker API key in the user-scoped cw config.")
    .option(
      "--worker-client-command <command>",
      "Persist a non-default local client bridge command in cw config."
    )
    .option("--worker-id <workerId>", "Explicit worker id used for register/interview")
    .option("--register-worker", "Register the configured worker in the cw workspace registry", false)
    .option("--interview-worker", "Run worker onboarding interview and persist the profile when allowed", false)
    .option("--typecheck-script <name>", "Add or replace the typecheck script mapping", collect, [])
    .option("--lint-script <name>", "Add or replace the lint script mapping", collect, [])
    .option("--test-script <name>", "Add or replace the test script mapping", collect, [])
    .option("--disable-validation-auto-discover", "Turn off validation script auto-discovery", false)
    .option(
      "--repository-write-mode <mode>",
      "Persist the default repository write mode in cw config (dry-run or allow-write)."
    )
    .option("--allow-write", "Persist cw workspace setup changes", false)
    .action(
      async (
        options: SetupOptions & {
          repositoryWriteMode?: string;
        }
      ) => {
        const repositoryWriteMode =
          options.repositoryWriteMode === "dry-run" ||
          options.repositoryWriteMode === "allow-write"
            ? options.repositoryWriteMode
            : options.repositoryWriteMode === undefined
              ? undefined
              : (() => {
                  throw new Error(
                    "--repository-write-mode must be either 'dry-run' or 'allow-write'."
                  );
                })();
        const result = await runSetup({
          ...options,
          repositoryWriteMode
        });

        writeOutput(io, result, formatSetupResult(result));
      }
    );
};
