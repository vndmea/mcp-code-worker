import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Command } from "commander";

import {
  AgentError,
  AoConfigSchema,
  getAoConfigPath,
  getAoWorkspaceAuditDirFromStorageDir,
  getAoWorkspaceRunsDirFromStorageDir,
  loadAoConfig,
  resolveExecutionContext,
  runDoctor,
  writeAuditEvent,
  type AoConfig,
  type ExecutionContext,
  type ModelConfig
} from "@agent-orchestrator/core";
import { runWorkerInterviewWorkflow } from "@agent-orchestrator/graph";
import {
  createWorkerProfileDoctorChecks,
  deriveWorkerRegistrationId,
  getWorkerProfileStorePath,
  getWorkerRegistryPath,
  readPersistedWorkerProfiles,
  readWorkerRegistry,
  saveWorkerProfile,
  saveWorkerRegistration
} from "@agent-orchestrator/models";

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

interface SetupResult {
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

interface SetupOptions {
  allowWrite: boolean;
  disableValidationAutoDiscover: boolean;
  interviewWorker: boolean;
  lintScript: string[];
  registerWorker: boolean;
  testScript: string[];
  typecheckScript: string[];
  workerBaseUrl?: string;
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
  existing: AoConfig["workerModel"],
  updates: {
    baseURL?: string;
    model?: string;
    provider?: string;
  }
) => {
  const hasUpdate =
    Boolean(updates.provider) ||
    Boolean(updates.model) ||
    Boolean(updates.baseURL);

  if (!existing && !hasUpdate) {
    return undefined;
  }

  return {
    ...(existing ?? {}),
    ...(updates.provider ? { provider: updates.provider } : {}),
    ...(updates.model ? { model: updates.model } : {}),
    ...(updates.baseURL ? { baseURL: updates.baseURL } : {})
  };
};

const buildDesiredConfig = (
  existing: AoConfig,
  options: SetupOptions
): AoConfig =>
  AoConfigSchema.parse({
    ...existing,
    version: 1,
    workerModel: mergeModelConfig(existing.workerModel, {
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
  desiredConfig: AoConfig
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
    `ao setup: ${result.status}`,
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

export const registerSetupCommand = (program: Command, io: CliIo): void => {
  program
    .command("setup")
    .description("Guide and optionally apply the user-scoped setup steps needed before ao task workflows feel reliable.")
    .option("--worker-provider <provider>", "Worker provider")
    .option("--worker-model <model>", "Worker model")
    .option("--worker-base-url <url>", "Worker base URL")
    .option("--worker-id <workerId>", "Explicit worker id used for register/interview")
    .option("--register-worker", "Register the configured worker in the ao workspace registry", false)
    .option("--interview-worker", "Run worker onboarding interview and persist the profile when allowed", false)
    .option("--typecheck-script <name>", "Add or replace the typecheck script mapping", collect, [])
    .option("--lint-script <name>", "Add or replace the lint script mapping", collect, [])
    .option("--test-script <name>", "Add or replace the test script mapping", collect, [])
    .option("--disable-validation-auto-discover", "Turn off validation script auto-discovery", false)
    .option("--allow-write", "Persist ao workspace setup changes", false)
    .action(async (options: SetupOptions) => {
      const context = await resolveExecutionContext({
        cliOverrides: {
          allowWrite: options.allowWrite,
          dryRun: !options.allowWrite
        }
      });
      const steps: SetupStepResult[] = [];
      const configResult = await loadAoConfig(context.rootDir);
      const desiredConfig = buildDesiredConfig(configResult.config, options);
      const registryState = await readWorkerRegistry(
        context.rootDir,
        context.aoStorageDir
      );
      const profileState = await readPersistedWorkerProfiles(
        context.rootDir,
        context.aoStorageDir
      );
      const aoDir = context.aoStorageDir;
      const auditDir = getAoWorkspaceAuditDirFromStorageDir(aoDir);
      const runsDir = getAoWorkspaceRunsDirFromStorageDir(aoDir);
      const configPath = getAoConfigPath(context.rootDir);
      const registryPath = getWorkerRegistryPath(
        context.rootDir,
        context.aoStorageDir
      );
      const profilesPath = getWorkerProfileStorePath(
        context.rootDir,
        context.aoStorageDir
      );

      const aoDirResult = await ensureDirectory(context, aoDir, options.allowWrite);
      const auditDirResult = await ensureDirectory(context, auditDir, options.allowWrite);
      const runsDirResult = await ensureDirectory(context, runsDir, options.allowWrite);

      steps.push({
        id: "workspace-scaffold",
        status: options.allowWrite ? "completed" : "dry-run",
        summary: options.allowWrite
          ? "Ensured user-scoped ao workspace directories exist for audit logs and task runs."
          : "Would ensure user-scoped ao workspace directories exist for audit logs and task runs.",
        details: {
          aoDir: relativePath(context.rootDir, aoDirResult.path),
          auditDir: relativePath(context.rootDir, auditDirResult.path),
          runsDir: relativePath(context.rootDir, runsDirResult.path)
        }
      });

      const configWrite = await writeManagedJson(
        context,
        configPath,
        desiredConfig,
        options.allowWrite,
        "setup-write-config"
      );
      steps.push({
        id: "configure-models",
        status: configWrite.mode === "execute" ? "completed" : "dry-run",
        path: relativePath(context.rootDir, configWrite.path),
        summary:
          configWrite.changed
            ? configWrite.mode === "execute"
              ? "Updated the ao workspace config with the requested model and validation settings."
              : "Would update the ao workspace config with the requested model and validation settings."
            : "The ao workspace config already matches the requested model and validation settings.",
        details: {
          replacedInvalidConfig: Boolean(configResult.error),
          workerModel: desiredConfig.workerModel
        }
      });

      if (registryState.error) {
        steps.push({
          id: "worker-registry-store",
          status: "blocked",
          path: relativePath(context.rootDir, registryPath),
          summary:
            "Existing worker registry is invalid. Fix or replace it before setup can manage worker registrations safely.",
          command: "ao doctor",
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
          options.allowWrite,
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
          command: "ao doctor",
          details: {
            error: profileState.error
          }
        });
      } else {
        const profileWrite = await writeManagedJson(
          context,
          profilesPath,
          profileState.profiles,
          options.allowWrite,
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
          options.allowWrite &&
          (options.typecheckScript.length > 0 ||
            options.lintScript.length > 0 ||
            options.testScript.length > 0 ||
            options.disableValidationAutoDiscover)
            ? "completed"
            : options.typecheckScript.length > 0 ||
                options.lintScript.length > 0 ||
                options.testScript.length > 0 ||
                options.disableValidationAutoDiscover
              ? "dry-run"
              : "skipped",
        command: "ao doctor",
        summary: buildValidationSummary(options),
        details: {
          validation: desiredConfig.validation
        }
      });

      const workerModel = resolveSetupWorkerModel(context, desiredConfig);
      const workerId = resolveSetupWorkerId(options, workerModel);

      if (options.registerWorker) {
        if (registryState.error) {
          steps.push({
            id: "register-worker",
            status: "blocked",
            summary:
              "Worker registration was requested, but the registry store is invalid.",
            command: "ao doctor"
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
            options.allowWrite
          );
          steps.push({
            id: "register-worker",
            status: registrationResult.mode === "execute" ? "completed" : "dry-run",
            path: relativePath(context.rootDir, registrationResult.path),
            summary:
              registrationResult.mode === "execute"
                ? `Registered worker ${workerId}.`
                : `Would register worker ${workerId}.`,
            command: "ao worker registry list",
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
            "ao worker register --provider <provider> --model <model> --allow-write"
        });
      }

      if (options.interviewWorker) {
        if (profileState.error) {
          steps.push({
            id: "interview-worker",
            status: "blocked",
            summary:
              "Worker interview was requested, but the profile store is invalid.",
            command: "ao doctor"
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
              command: "ao worker interview --save",
              details: {
                recommendedActions:
                  interviewResult.persistenceAdvice.recommendedActions,
                warnings: interviewResult.warnings
              }
            });
          } else if (options.allowWrite) {
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
              command: "ao worker profile",
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
              command: "ao worker interview --save",
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
          command: "ao worker interview --save"
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
        command: "ao doctor",
        summary: readinessSummary,
        details: readinessCapabilities
      });

      const result: SetupResult = {
        mode: options.allowWrite ? "execute" : "dry-run",
        rootDir: context.rootDir,
        status: resultStatus,
        summary: readinessSummary,
        steps,
        recommendedEnv: unique([
          desiredConfig.workerModel &&
          !["mock", "client", "local-client"].includes(
            desiredConfig.workerModel.provider
          )
            ? "WORKER_MODEL_API_KEY"
            : undefined
        ]).map((name) => `export ${name}=...`),
        minimalSuccessPath,
        recommendedEntrypoints,
        recommendedActions: finalDoctor.recommendedActions.slice(0, 6)
      };

      writeOutput(io, result, formatSetupResult(result));
    });
};
