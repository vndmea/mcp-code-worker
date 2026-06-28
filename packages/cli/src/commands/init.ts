import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

import type { Command } from "commander";

import {
  getCwConfigPath,
  getCwHomeDir,
  getCwWorkspaceDir,
  normalizeFileSystemPath,
  resolveExecutionContext,
  type DoctorStatus,
  type ExecutionContext,
  type ModelConfig
} from "@mcp-code-worker/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  runWorkerInterviewWorkflow,
  saveWorkerBenchmarkArtifact
} from "@mcp-code-worker/graph";
import {
  createWorkerConnectivityDoctorChecks,
  getWorkerRegistration,
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { formatDisplayPath, writeOutput } from "../output.js";
import { openPathInSystemApp, type PathOpener } from "../system/open-path.js";
import {
  detectInitPreset,
  getInitPreset,
  INIT_PRESETS,
  type InitPresetId
} from "./init-presets.js";
import { buildMcpConfigSnippet } from "./mcp.js";
import {
  formatSetupResult,
  runSetup,
  type SetupOptions,
  type SetupResult
} from "./setup.js";
import type { WorkerReadinessBlockedReasonType } from "./worker-readiness.js";

export interface InitPrompter {
  close?: () => Promise<void> | void;
  confirm: (message: string, defaultValue: boolean) => Promise<boolean>;
  select: <T extends string>(
    message: string,
    options: Array<{
      label: string;
      value: T;
    }>,
    defaultValue: T
  ) => Promise<T>;
  text: (
    message: string,
    options?: {
      allowEmpty?: boolean;
      defaultValue?: string;
    }
  ) => Promise<string>;
}

interface InitOptions extends Omit<SetupOptions, "repositoryWriteMode"> {
  advanced: boolean;
  preset?: string;
  repositoryWriteMode?: string;
}

interface InitWorkerPlan {
  apiKey?: string;
  baseUrl?: string;
  benchmarkWorker: boolean;
  interviewWorker: boolean;
  isDefault: boolean;
  probeWorker: boolean;
  registerWorker: boolean;
  workerId: string;
  workerMode: "api" | "client";
  workerModel: string;
  workerProvider: string;
}

type InitWorkerStepStatus =
  | "blocked"
  | "completed"
  | "dry-run"
  | "not-requested"
  | "skipped";

interface InitWorkerSummary {
  benchmarkStatus?: InitWorkerStepStatus;
  benchmarkWorker: boolean;
  configured: boolean;
  interviewWorker: boolean;
  interviewStatus?: InitWorkerStepStatus;
  isDefault: boolean;
  probeStatus?: InitWorkerStepStatus;
  probeWorker: boolean;
  readinessBlockedReasonType?: WorkerReadinessBlockedReasonType;
  readinessStatus?: DoctorStatus | "dry-run" | "skipped";
  registerWorker: boolean;
  registerStatus?: InitWorkerStepStatus;
  workerId?: string;
  workerMode?: "api" | "client";
  workerModel?: string;
  workerProvider?: string;
}

interface InitResult {
  advanced: boolean;
  applied: boolean;
  enableMcp: boolean;
  mcpConfig?: ReturnType<typeof buildMcpConfigSnippet>;
  openedConfigDirectory: boolean;
  paths: {
    cwConfigDir: string;
    cwConfigPath: string;
    cwHomeDir: string;
    cwStorageDir: string;
    globalAgentsPath: string;
    projectAgentsPath: string;
  };
  repositoryWriteMode: NonNullable<SetupOptions["repositoryWriteMode"]>;
  rootDir: string;
  setup: SetupResult;
  tips: string[];
  worker: InitWorkerSummary & {
    additionalWorkers: InitWorkerSummary[];
  };
  workers: InitWorkerSummary[];
}

const toYesNoSuffix = (defaultValue: boolean): string =>
  defaultValue ? " [Y/n]" : " [y/N]";

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value
];

const normalizeConfirmAnswer = (
  value: string,
  defaultValue: boolean
): boolean | null => {
  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0) {
    return defaultValue;
  }

  if (["y", "yes"].includes(normalized)) {
    return true;
  }

  if (["n", "no"].includes(normalized)) {
    return false;
  }

  return null;
};

const createReadlinePrompter = (): InitPrompter => {
  const readline = createInterface({
    input,
    output
  });

  const select = async <T extends string>(
    message: string,
    options: Array<{
      label: string;
      value: T;
    }>,
    defaultValue: T
  ): Promise<T> => {
    if (!input.isTTY || !output.isTTY) {
      throw new Error("Interactive selection requires a TTY.");
    }

    const defaultIndex = Math.max(
      0,
      options.findIndex((option) => option.value === defaultValue)
    );
    const totalLines = options.length + 1;
    let activeIndex = defaultIndex;
    let rendered = false;

    const render = (): void => {
      if (rendered) {
        output.write(`\u001b[${totalLines}F\u001b[J`);
      }

      output.write(`${message}\n`);

      for (let index = 0; index < options.length; index += 1) {
        const option = options[index];

        if (!option) {
          continue;
        }

        output.write(
          `${index === activeIndex ? "\u001b[36m❯\u001b[0m" : " "} ${option.label}\n`
        );
      }

      rendered = true;
    };

    return await new Promise<T>((resolveChoice, rejectChoice) => {
      const previousRawMode = input.isRaw;
      const cleanup = (): void => {
        input.off("keypress", onKeypress);
        if (input.isTTY) {
          input.setRawMode(previousRawMode ?? false);
        }
      };
      const finish = (value: T): void => {
        cleanup();
        resolveChoice(value);
      };
      const fail = (error: Error): void => {
        cleanup();
        rejectChoice(error);
      };
      const onKeypress = (_value: string, key: { ctrl?: boolean; name?: string }) => {
        if (key.ctrl && key.name === "c") {
          fail(new Error("Prompt cancelled."));
          return;
        }

        if (key.name === "up") {
          activeIndex = activeIndex === 0 ? options.length - 1 : activeIndex - 1;
          render();
          return;
        }

        if (key.name === "down") {
          activeIndex = activeIndex === options.length - 1 ? 0 : activeIndex + 1;
          render();
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          finish(options[activeIndex]!.value);
        }
      };

      emitKeypressEvents(input);
      input.on("keypress", onKeypress);
      input.setRawMode(true);
      input.resume();
      render();
    });
  };

  return {
    close: () => {
      readline.close();
      return Promise.resolve();
    },
    confirm: async (message: string, defaultValue: boolean) => {
      while (true) {
        const answer = await readline.question(
          `${message}${toYesNoSuffix(defaultValue)} `
        );
        const parsed = normalizeConfirmAnswer(answer, defaultValue);

        if (parsed !== null) {
          return parsed;
        }

        output.write("Please answer yes or no.\n");
      }
    },
    select,
    text: async (
      message: string,
      options: {
        allowEmpty?: boolean;
        defaultValue?: string;
      } = {}
    ) => {
      while (true) {
        const promptSuffix =
          options.defaultValue !== undefined
            ? ` [${options.defaultValue}]`
            : "";
        const answer = await readline.question(`${message}${promptSuffix} `);
        const trimmed = answer.trim();

        if (trimmed.length > 0) {
          return trimmed;
        }

        if (options.defaultValue !== undefined) {
          return options.defaultValue;
        }

        if (options.allowEmpty) {
          return "";
        }

        output.write("Please enter a value.\n");
      }
    }
  };
};

const resolveApiProviderDefault = (
  provider: string
): string =>
  ["mock", "client"].includes(provider)
    ? "openai-compatible"
    : provider;

const describeRepositoryWriteMode = (
  repositoryWriteMode: NonNullable<SetupOptions["repositoryWriteMode"]>
): string =>
  repositoryWriteMode === "allow-write"
    ? "enabled by default"
    : "dry-run only by default";

const buildInitPaths = (rootDir: string): InitResult["paths"] => {
  const cwHomeDir = getCwHomeDir();
  const cwStorageDir = getCwWorkspaceDir(rootDir);
  const cwConfigPath = getCwConfigPath(rootDir);

  return {
    cwConfigDir: dirname(cwConfigPath),
    cwConfigPath,
    cwHomeDir,
    cwStorageDir,
    globalAgentsPath: resolve(homedir(), ".codex", "AGENTS.md"),
    projectAgentsPath: resolve(rootDir, "AGENTS.md")
  };
};

const buildInitTips = (result: Pick<InitResult, "enableMcp" | "paths">): string[] => [
  `Edit ${result.paths.cwConfigPath} manually if you need to tweak worker defaults or MCP-related runtime state.`,
  `Put project-only instructions in ${result.paths.projectAgentsPath}; put global Codex defaults in ${result.paths.globalAgentsPath}.`,
  result.enableMcp
    ? "Paste the MCP snippet into a workspace-scoped host config for this repository only, or into the host's global MCP config for every repository."
    : "You can always rerun `cw mcp config` later when you are ready to wire an MCP host.",
  "Use `cw init` again when you want to revisit worker verification depth or onboarding defaults."
];

const formatWorkerSummary = (result: InitResult["worker"]): string => {
  const workers = [
    result,
    ...result.additionalWorkers
  ].filter(
    (worker): worker is InitWorkerSummary & {
      workerId: string;
      workerModel: string;
      workerProvider: string;
    } => Boolean(worker.workerId) && Boolean(worker.workerProvider) && Boolean(worker.workerModel)
  );

  if (workers.length === 0) {
    return "skipped";
  }

  return workers
    .map((worker) =>
      [
        worker.isDefault ? "default" : "extra",
        `${worker.workerId} (${worker.workerProvider}/${worker.workerModel})`,
        `configured=${worker.configured ? "yes" : "no"}`,
        `registered=${worker.registerStatus ?? (worker.registerWorker ? "planned" : "skipped")}`,
        `probed=${worker.probeStatus ?? (worker.probeWorker ? "planned" : "skipped")}`,
        `interviewed=${worker.interviewStatus ?? (worker.interviewWorker ? "planned" : "skipped")}`,
        `benchmarked=${worker.benchmarkStatus ?? (worker.benchmarkWorker ? "planned" : "skipped")}`,
        worker.readinessStatus
          ? [
              `readiness=${worker.readinessStatus}`,
              worker.readinessBlockedReasonType &&
              worker.readinessBlockedReasonType !== "not-applicable"
                ? `(${worker.readinessBlockedReasonType})`
                : null
            ]
              .filter((value): value is string => Boolean(value))
              .join("")
          : null
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
    )
    .join(" | ");
};

const formatInitResult = (result: InitResult): string[] => {
  const lines: string[] = [
    `cw init: ${result.applied ? "applied" : "preview"}`,
    result.applied
      ? "Onboarding choices were processed and the workspace readiness summary is below."
      : "Onboarding choices were previewed only. No local cw files were written.",
    `workspace: ${result.rootDir}`,
    `cw home: ${formatDisplayPath(result.rootDir, result.paths.cwHomeDir)}`,
    `cw storage: ${formatDisplayPath(result.rootDir, result.paths.cwStorageDir)}`,
    `cw config: ${formatDisplayPath(result.rootDir, result.paths.cwConfigPath)}`,
    `repository writes: ${describeRepositoryWriteMode(result.repositoryWriteMode)}`,
    `mcp: ${result.enableMcp ? "snippet prepared" : "skipped"}`,
    `workers: ${formatWorkerSummary(result.worker)}`,
    `setup: ${result.setup.status}`,
    `agents: project -> ${formatDisplayPath(result.rootDir, result.paths.projectAgentsPath)} | global -> ${formatDisplayPath(result.rootDir, result.paths.globalAgentsPath)}`,
    `next: ${result.setup.recommendedActions.slice(0, 2).join(" | ") || "Run cw doctor"} | cw doctor --probe`
  ];

  lines.push(
    `tips: ${result.tips.slice(0, 3).join(" | ")}`
  );

  if (result.openedConfigDirectory) {
    lines.push(
      `config dir opened: ${formatDisplayPath(result.rootDir, result.paths.cwConfigDir)}`
    );
  }

  if (result.mcpConfig) {
    lines.push("mcp config snippet:");
    lines.push(JSON.stringify(result.mcpConfig, null, 2));
  }

  return lines;
};

const readSetupStepStatus = (
  result: SetupResult,
  stepId: string
): InitWorkerStepStatus | undefined => {
  const step = result.steps.find((entry) => entry.id === stepId);

  if (!step) {
    return undefined;
  }

  if (step.status === "needs-input") {
    return "blocked";
  }

  return step.status;
};

const mergePrimaryWorkerSummary = (
  worker: InitResult["worker"],
  setup: SetupResult
): InitResult["worker"] => ({
  ...worker,
  benchmarkStatus: readSetupStepStatus(setup, "benchmark-worker"),
  configured: worker.configured || Boolean(worker.workerId),
  interviewStatus: readSetupStepStatus(setup, "interview-worker"),
  probeStatus: readSetupStepStatus(setup, "probe-worker"),
  readinessStatus: setup.status === "blocked" ? "blocked" : "ready",
  registerStatus: readSetupStepStatus(setup, "register-worker")
});

const hasScriptedSetupInputs = (options: InitOptions): boolean =>
  options.allowWrite ||
  options.benchmarkWorker ||
  options.disableValidationAutoDiscover ||
  options.interviewWorker ||
  options.probeWorker ||
  options.registerWorker ||
  options.typecheckScript.length > 0 ||
  options.lintScript.length > 0 ||
  options.testScript.length > 0 ||
  options.repositoryWriteMode !== undefined ||
  Boolean(options.preset) ||
  Boolean(options.workerApiKey) ||
  Boolean(options.workerBaseUrl) ||
  Boolean(options.workerClientCommand) ||
  Boolean(options.workerId) ||
  Boolean(options.workerModel) ||
  Boolean(options.workerProvider);

const collectInitSetupOptions = async (
  options: InitOptions,
  prompter: InitPrompter
): Promise<{
  additionalWorkers: InitWorkerPlan[];
  enableMcp: boolean;
  setup: SetupOptions;
  worker: InitWorkerSummary & {
    additionalWorkers: InitWorkerSummary[];
  };
  workers: InitWorkerSummary[];
}> => {
  const initialRoot = normalizeFileSystemPath(options.root ?? process.cwd());
  const rootDir = normalizeFileSystemPath(
    await prompter.text("Workspace root?", {
      defaultValue: initialRoot
    })
  );
  const keepDryRun = await prompter.confirm(
    "Keep repository writes in dry-run mode by default?",
    true
  );
  const enableMcp = await prompter.confirm(
    "Prepare an MCP config snippet for this workspace?",
    true
  );
  const configureWorker = await prompter.confirm(
    "Configure a default worker now?",
    false
  );
  const workerContext = await resolveExecutionContext({ rootDir });
  const setup: SetupOptions = {
    allowWrite: false,
    benchmarkWorker: false,
    disableValidationAutoDiscover: false,
    interviewWorker: false,
    lintScript: [],
    probeWorker: false,
    repositoryWriteMode: keepDryRun ? "dry-run" : "allow-write",
    root: rootDir,
    registerWorker: false,
    testScript: [],
    typecheckScript: [],
    workerApiKey: undefined,
    workerBaseUrl: undefined,
    workerClientCommand: undefined,
    workerId: undefined,
    workerModel: undefined,
    workerProvider: undefined
  };
  const additionalWorkers: InitWorkerPlan[] = [];
  const workerSummaries: InitWorkerSummary[] = [];
  const reservedWorkerIds = new Set<string>();

  const promptWorkerPlan = async (
    isDefault: boolean
  ): Promise<InitWorkerPlan> => {
    const presetChoice = await prompter.select<InitPresetId | "custom">(
      isDefault ? "Default worker preset?" : "Additional worker preset?",
      [
        ...INIT_PRESETS.map((preset) => ({
          label: preset.label,
          value: preset.id
        })),
        {
          label: "Custom",
          value: "custom" as const
        }
      ],
      detectInitPreset(workerContext.workerModel) ?? "mock"
    );

    const selectedPreset =
      presetChoice === "custom" ? undefined : getInitPreset(presetChoice);

    let workerMode: "api" | "client" =
      selectedPreset?.workerProvider === "client" ? "client" : "api";
    let workerProvider =
      selectedPreset?.workerProvider ??
      resolveApiProviderDefault(workerContext.workerModel.provider);
    let workerModel =
      selectedPreset?.workerModel ?? workerContext.workerModel.model;

    let baseUrl: string | undefined;
    let apiKey: string | undefined;

    if (!selectedPreset) {
      workerMode = await prompter.select(
        isDefault ? "Default worker mode?" : "Additional worker mode?",
        [
          {
            label: "Local client",
            value: "client"
          },
          {
            label: "API model",
            value: "api"
          }
        ],
        "client"
      );

      workerProvider =
        workerMode === "client"
          ? "client"
          : resolveApiProviderDefault(workerContext.workerModel.provider);
      workerModel = await prompter.text(
        workerMode === "client" ? "Worker model label?" : "Worker model?",
        {
          defaultValue: workerContext.workerModel.model
        }
      );

      if (workerMode === "api") {
        workerProvider = await prompter.text("Worker provider?", {
          defaultValue: workerProvider
        });
      }
    } else {
      baseUrl = selectedPreset.workerBaseUrl;
      if (isDefault && selectedPreset.workerClientCommand) {
        setup.workerClientCommand = selectedPreset.workerClientCommand;
      }
    }

    if (
      workerMode === "api" &&
      (options.advanced ||
        (!selectedPreset &&
          (Boolean(workerContext.workerModel.baseURL) ||
            !["mock", "client"].includes(workerProvider))))
    ) {
      const promptedBaseUrl = await prompter.text(
        "Worker base URL? Leave blank to skip.",
        {
          allowEmpty: true,
          defaultValue: baseUrl ?? workerContext.workerModel.baseURL ?? ""
        }
      );
      baseUrl = promptedBaseUrl.length > 0 ? promptedBaseUrl : undefined;
    }

    if (
      workerMode === "api" &&
      !["mock", "client"].includes(workerProvider)
    ) {
      const promptedApiKey = await prompter.text(
        "Worker API key? Leave blank to skip.",
        {
          allowEmpty: true
        }
      );
      apiKey = promptedApiKey.length > 0 ? promptedApiKey : undefined;
    }

    if (
      isDefault &&
      workerMode === "client" &&
      (options.advanced ||
        Boolean(workerContext.workerModel.clientCommand) ||
        Boolean(selectedPreset?.workerClientCommand))
    ) {
      const promptedClientCommand = await prompter.text(
        "Local client command? Leave blank to use opencode.",
        {
          allowEmpty: true,
          defaultValue:
            setup.workerClientCommand ??
            workerContext.workerModel.clientCommand ??
            ""
        }
      );
      setup.workerClientCommand =
        promptedClientCommand.length > 0 ? promptedClientCommand : undefined;
    }

    let workerIdPrompt = isDefault
      ? "Default worker name?"
      : "Additional worker name?";
    const defaultWorkerId = isDefault
      ? "default-worker"
      : `worker-${workerSummaries.length + 1}`;
    let workerId = "";

    while (workerId.length === 0) {
      const candidate = await prompter.text(workerIdPrompt, {
        defaultValue: defaultWorkerId
      });

      if (reservedWorkerIds.has(candidate)) {
        workerIdPrompt = `Worker name '${candidate}' is already queued in this init run. Choose another worker name.`;
        continue;
      }

      const existingRegistration = await getWorkerRegistration(
        workerContext.rootDir,
        candidate,
        workerContext.cwStorageDir
      );

      if (existingRegistration) {
        workerIdPrompt = `Worker name '${candidate}' already exists in the registry. Choose another worker name.`;
        continue;
      }

      workerId = candidate;
    }

    const verificationDepth = await prompter.select<
      "full" | "probe-only" | "skip"
    >(
      "How much worker verification should init perform now?",
      [
        {
          label: "Probe + interview + benchmark",
          value: "full"
        },
        {
          label: "Probe only",
          value: "probe-only"
        },
        {
          label: "Skip for now",
          value: "skip"
        }
      ],
      "probe-only"
    );

    return {
      apiKey,
      baseUrl,
      benchmarkWorker: verificationDepth === "full",
      interviewWorker: verificationDepth === "full",
      isDefault,
      probeWorker: verificationDepth !== "skip",
      registerWorker: true,
      workerId,
      workerMode,
      workerModel,
      workerProvider
    };
  };

  if (configureWorker) {
    const defaultWorker = await promptWorkerPlan(true);
    setup.workerApiKey = defaultWorker.apiKey;
    setup.workerBaseUrl = defaultWorker.baseUrl;
    setup.benchmarkWorker = defaultWorker.benchmarkWorker;
    setup.interviewWorker = defaultWorker.interviewWorker;
    setup.probeWorker = defaultWorker.probeWorker;
    setup.registerWorker = defaultWorker.registerWorker;
    setup.workerId = defaultWorker.workerId;
    setup.workerModel = defaultWorker.workerModel;
    setup.workerProvider = defaultWorker.workerProvider;
    reservedWorkerIds.add(defaultWorker.workerId);
    workerSummaries.push({
      benchmarkWorker: defaultWorker.benchmarkWorker,
      configured: true,
      interviewWorker: defaultWorker.interviewWorker,
      isDefault: true,
      probeWorker: defaultWorker.probeWorker,
      registerWorker: true,
      workerId: defaultWorker.workerId,
      workerMode: defaultWorker.workerMode,
      workerModel: defaultWorker.workerModel,
      workerProvider: defaultWorker.workerProvider
    });

    while (
      await prompter.confirm(
        "Register another worker? Only one worker handles a task at a time, but the host can switch workers between steps.",
        false
      )
    ) {
      const nextWorker = await promptWorkerPlan(false);
      additionalWorkers.push(nextWorker);
      reservedWorkerIds.add(nextWorker.workerId);
      workerSummaries.push({
        benchmarkWorker: nextWorker.benchmarkWorker,
        configured: true,
        interviewWorker: nextWorker.interviewWorker,
        isDefault: false,
        probeWorker: nextWorker.probeWorker,
        registerWorker: true,
        workerId: nextWorker.workerId,
        workerMode: nextWorker.workerMode,
        workerModel: nextWorker.workerModel,
        workerProvider: nextWorker.workerProvider
      });
    }
  }

  if (options.advanced) {
    const keepAutoDiscover = await prompter.confirm(
      "Keep validation script auto-discovery enabled?",
      true
    );
    setup.disableValidationAutoDiscover = !keepAutoDiscover;

    const typecheckScript = await prompter.text(
      "Explicit typecheck script? Leave blank to keep current behavior.",
      { allowEmpty: true }
    );
    const lintScript = await prompter.text(
      "Explicit lint script? Leave blank to keep current behavior.",
      { allowEmpty: true }
    );
    const testScript = await prompter.text(
      "Explicit test script? Leave blank to keep current behavior.",
      { allowEmpty: true }
    );

    if (typecheckScript.length > 0) {
      setup.typecheckScript = [typecheckScript];
    }

    if (lintScript.length > 0) {
      setup.lintScript = [lintScript];
    }

    if (testScript.length > 0) {
      setup.testScript = [testScript];
    }
  }

  return {
    additionalWorkers,
    enableMcp,
    setup,
    worker: {
      ...(workerSummaries[0] ?? {
        benchmarkWorker: false,
        configured: false,
        interviewWorker: false,
        isDefault: false,
        probeWorker: false,
        registerWorker: false
      }),
      additionalWorkers: workerSummaries.slice(1)
    },
    workers: workerSummaries
  };
};

const registerAdditionalWorkers = async (
  rootDir: string,
  workers: InitWorkerPlan[]
): Promise<InitWorkerSummary[]> => {
  if (workers.length === 0) {
    return [];
  }

  const context = await resolveExecutionContext({
    rootDir,
    cliOverrides: {
      allowWrite: true,
      dryRun: false
    }
  });

  const runProbe = async (
    resolvedContext: ExecutionContext,
    worker: InitWorkerPlan
  ): Promise<InitWorkerStepStatus> => {
    if (!worker.probeWorker) {
      return "skipped";
    }

    const checks = await createWorkerConnectivityDoctorChecks({
      ...resolvedContext,
      defaultWorkerId: worker.workerId,
      workerModel: {
        ...resolvedContext.workerModel,
        provider: worker.workerProvider,
        model: worker.workerModel,
        baseURL: worker.baseUrl
      }
    });

    return checks[0]?.status === "pass" ? "completed" : "blocked";
  };

  for (const worker of workers) {
    await saveWorkerRegistration(
      context,
      {
        workerId: worker.workerId,
        provider: worker.workerProvider,
        model: worker.workerModel,
        baseURL: worker.baseUrl,
        enabled: true,
        tags: ["setup", "init"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      true
    );
  }

  const summaries: InitWorkerSummary[] = [];

  for (const worker of workers) {
    const modelConfig: ModelConfig = {
      ...context.workerModel,
      provider: worker.workerProvider,
      model: worker.workerModel,
      baseURL: worker.baseUrl,
      apiKey: context.workerModel.apiKey
    };
    const probeStatus = await runProbe(context, worker);
    let interviewStatus: InitWorkerStepStatus = worker.interviewWorker
      ? "blocked"
      : "skipped";
    let benchmarkStatus: InitWorkerStepStatus = worker.benchmarkWorker
      ? "blocked"
      : "skipped";
    let readinessStatus: DoctorStatus =
      probeStatus === "blocked" ? "blocked" : "ready";
    let readinessBlockedReasonType: WorkerReadinessBlockedReasonType =
      probeStatus === "blocked" ? "probe-failed" : "not-applicable";

    if (worker.interviewWorker) {
      const interviewResult = await runWorkerInterviewWorkflow({
        context,
        workerId: worker.workerId,
        modelConfig
      });

      if (!interviewResult.persistenceAdvice.canPersist) {
        interviewStatus = "blocked";
        benchmarkStatus = worker.benchmarkWorker ? "blocked" : "skipped";
        readinessStatus = "blocked";
        readinessBlockedReasonType = "profile-provider-error";
      } else {
        await saveWorkerProfile(context, interviewResult.profile, true);
        interviewStatus = "completed";

        if (worker.benchmarkWorker) {
          const benchmarkResult = await runWorkerBenchmarkWorkflow({
            context,
            suite: "coding-v1",
            workerId: worker.workerId,
            modelConfig
          });
          await saveWorkerBenchmarkArtifact(context, benchmarkResult, true);
          const profileUpdate = applyBenchmarkCapabilityUpdate(
            interviewResult.profile,
            benchmarkResult,
            {
              updateProfileCapabilities: true
            }
          );
          await saveWorkerProfile(context, profileUpdate.profile, true);
          benchmarkStatus = "completed";
          readinessStatus = profileUpdate.patchGenerationQualified
            ? "ready"
            : "blocked";
          readinessBlockedReasonType = profileUpdate.patchGenerationQualified
            ? "not-applicable"
            : "worker-not-qualified";
        }
      }
    }

    summaries.push({
      benchmarkStatus,
      benchmarkWorker: worker.benchmarkWorker,
      configured: true,
      interviewStatus,
      interviewWorker: worker.interviewWorker,
      isDefault: false,
      probeStatus,
      probeWorker: worker.probeWorker,
      readinessBlockedReasonType,
      readinessStatus,
      registerStatus: "completed",
      registerWorker: true,
      workerId: worker.workerId,
      workerMode: worker.workerMode,
      workerModel: worker.workerModel,
      workerProvider: worker.workerProvider
    });
  }

  return summaries;
};

export const registerInitCommand = (
  program: Command,
  io: CliIo,
  injectedPrompter?: InitPrompter,
  pathOpener: PathOpener = openPathInSystemApp
): void => {
  program
    .command("init")
    .description("Run the cw onboarding flow, either interactively or through scripted flags, and persist the chosen local setup.")
    .option("--advanced", "Ask for additional worker and validation setup details.", false)
    .option(
      "--preset <name>",
      `Apply a worker preset: ${INIT_PRESETS.map((preset) => preset.id).join(", ")}.`
    )
    .option("--root <path>", "Pre-fill the workspace root shown in the onboarding flow.")
    .option("--worker-provider <provider>", "Worker provider")
    .option("--worker-model <model>", "Worker model")
    .option("--worker-base-url <url>", "Worker base URL")
    .option("--worker-api-key <key>", "Persist a worker API key in the user-scoped cw config.")
    .option(
      "--worker-client-command <command>",
      "Persist a non-default local client bridge command in cw config."
    )
    .option("--worker-id <workerId>", "User-defined worker name used for register/interview")
    .option("--register-worker", "Register the configured worker in the cw workspace registry", false)
    .option("--probe-worker", "Run a live worker connectivity probe during onboarding", false)
    .option("--interview-worker", "Run worker onboarding interview and persist the profile when allowed", false)
    .option(
      "--benchmark-worker",
      "Run the coding benchmark after interview persistence and update capabilities",
      false
    )
    .option("--typecheck-script <name>", "Add or replace the typecheck script mapping", collect, [])
    .option("--lint-script <name>", "Add or replace the lint script mapping", collect, [])
    .option("--test-script <name>", "Add or replace the test script mapping", collect, [])
    .option("--disable-validation-auto-discover", "Turn off validation script auto-discovery", false)
    .option(
      "--repository-write-mode <mode>",
      "Persist the default repository write mode in cw config (dry-run or allow-write)."
    )
    .option("--allow-write", "Persist cw workspace setup changes", false)
    .action(async (options: InitOptions) => {
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

      const canPrompt =
        Boolean(injectedPrompter) || (process.stdin.isTTY && process.stdout.isTTY);
      const shouldRunScripted = !canPrompt || hasScriptedSetupInputs(options);
      const preset = getInitPreset(options.preset);

      if (options.preset && !preset) {
        throw new Error(
          `Unsupported preset '${options.preset}'. Expected one of: ${INIT_PRESETS.map((entry) => entry.id).join(", ")}.`
        );
      }

      if (shouldRunScripted) {
        if (
          (options.registerWorker ||
            options.probeWorker ||
            options.interviewWorker ||
            options.benchmarkWorker) &&
          !options.workerId
        ) {
          throw new Error(
            "--worker-id is required for scripted worker onboarding so cw can use a stable user-defined worker name."
          );
        }

        const result = await runSetup({
          allowWrite: options.allowWrite,
          benchmarkWorker: options.benchmarkWorker,
          disableValidationAutoDiscover: options.disableValidationAutoDiscover,
          interviewWorker: options.interviewWorker,
          lintScript: options.lintScript,
          probeWorker: options.probeWorker,
          registerWorker: options.registerWorker,
          repositoryWriteMode,
          root: options.root,
          testScript: options.testScript,
          typecheckScript: options.typecheckScript,
          workerApiKey: options.workerApiKey,
          workerBaseUrl: options.workerBaseUrl ?? preset?.workerBaseUrl,
          workerClientCommand: options.workerClientCommand,
          workerId: options.workerId,
          workerModel: options.workerModel ?? preset?.workerModel,
          workerProvider: options.workerProvider ?? preset?.workerProvider
        });

        writeOutput(io, result, formatSetupResult(result));
        return;
      }

      const prompter = injectedPrompter ?? createReadlinePrompter();

      try {
        const collected = await collectInitSetupOptions(options, prompter);
        const applyNow = await prompter.confirm(
          "Apply this onboarding setup now?",
          true
        );
        const setup = await runSetup({
          ...collected.setup,
          allowWrite: applyNow
        });
        const additionalWorkerSummaries = applyNow
          ? await registerAdditionalWorkers(
              setup.rootDir,
              collected.additionalWorkers
            )
          : collected.additionalWorkers.map<InitWorkerSummary>((worker) => ({
              benchmarkStatus: worker.benchmarkWorker ? "dry-run" : "skipped",
              benchmarkWorker: worker.benchmarkWorker,
              configured: true,
              interviewStatus: worker.interviewWorker ? "dry-run" : "skipped",
              interviewWorker: worker.interviewWorker,
              isDefault: false,
              probeStatus: worker.probeWorker ? "dry-run" : "skipped",
              probeWorker: worker.probeWorker,
              readinessStatus: worker.probeWorker ? "dry-run" : "skipped",
              registerStatus: "dry-run",
              registerWorker: true,
              workerId: worker.workerId,
              workerMode: worker.workerMode,
              workerModel: worker.workerModel,
              workerProvider: worker.workerProvider
            }));
        const paths = buildInitPaths(setup.rootDir);
        let openedConfigDirectory = false;

        if (
          applyNow &&
          await prompter.confirm(
            `Open the cw config directory now? (${formatDisplayPath(setup.rootDir, paths.cwConfigDir)})`,
            false
          )
        ) {
          openedConfigDirectory = await pathOpener(paths.cwConfigDir);
        }
        const result: InitResult = {
          advanced: options.advanced,
          applied: applyNow,
          enableMcp: collected.enableMcp,
          mcpConfig: collected.enableMcp
            ? buildMcpConfigSnippet()
            : undefined,
          openedConfigDirectory,
          paths,
          repositoryWriteMode:
            collected.setup.repositoryWriteMode ?? "dry-run",
          rootDir: setup.rootDir,
          setup,
          tips: buildInitTips({
            enableMcp: collected.enableMcp,
            paths
          }),
          worker: mergePrimaryWorkerSummary(collected.worker, setup),
          workers: [
            mergePrimaryWorkerSummary(collected.worker, setup),
            ...additionalWorkerSummaries
          ]
        };
        result.worker.additionalWorkers = additionalWorkerSummaries;

        writeOutput(io, result, formatInitResult(result));
      } finally {
        await prompter.close?.();
      }
    });
};
