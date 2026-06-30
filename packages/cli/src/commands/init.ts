import { emitKeypressEvents } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
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
  resolveExecutionContext
} from "@mcp-code-worker/core";
import { getWorkerRegistration } from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { formatDisplayPath, writeOutput } from "../output.js";
import { openPathInSystemApp, type PathOpener } from "../system/open-path.js";
import {
  detectInitPreset,
  getInitPreset,
  INIT_PRESETS,
  type InitPresetId
} from "./init-presets.js";
import { buildMcpConfigSnippet, renderMcpConfigSnippet } from "./mcp.js";
import {
  formatSetupResult,
  runSetup,
  type SetupOptions,
  type SetupResult,
  type SetupStepStatus,
  type SetupWorkerPlan,
  type SetupWorkerSummary
} from "./setup.js";

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
  repositoryWriteMode?: string;
  writeCodexMcpConfig: boolean;
}

type InitWorkerPlan = SetupWorkerPlan;

type CodexMcpConfigStatus = "not-requested" | "written" | "missing-file";

interface CodexMcpConfigUpdateResult {
  exists: boolean;
  path: string;
  status: CodexMcpConfigStatus;
}

interface InitResult {
  advanced: boolean;
  applied: boolean;
  codexMcpConfig: CodexMcpConfigUpdateResult;
  enableMcp: boolean;
  mcpConfig?: ReturnType<typeof buildMcpConfigSnippet>;
  openedConfigDirectory: boolean;
  paths: {
    codexConfigPath: string;
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
  worker: SetupWorkerSummary & {
    additionalWorkers: SetupWorkerSummary[];
  };
  workers: SetupWorkerSummary[];
}

const toYesNoSuffix = (defaultValue: boolean): string =>
  defaultValue ? " [Y/n]" : " [y/N]";

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value
];

const formatWorkerVerificationWarning = (
  verificationDepth: "full" | "probe-only" | "skip"
): string | null => {
  if (verificationDepth === "full") {
    return null;
  }

  if (verificationDepth === "probe-only") {
    return [
      "This only runs a connectivity probe.",
      "cw will skip interview and benchmark, so no persisted worker profile or patch-generation qualification will be created.",
      "Formal tasks may remain unavailable until you run those steps manually.",
      "Continue anyway?"
    ].join(" ");
  }

  return [
    "This skips probe, interview, and benchmark.",
    "cw will not verify connectivity, will not create a persisted worker profile, and will not establish patch-generation qualification.",
    "Formal tasks may remain unavailable until you run those steps manually.",
    "Continue anyway?"
  ].join(" ");
};

const promptWorkerVerificationDepth = async (
  prompter: InitPrompter
): Promise<"full" | "probe-only" | "skip"> => {
  while (true) {
    const verificationDepth = await prompter.select<"full" | "probe-only" | "skip">(
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
    const warning = formatWorkerVerificationWarning(verificationDepth);

    if (!warning) {
      return verificationDepth;
    }

    if (await prompter.confirm(warning, false)) {
      return verificationDepth;
    }
  }
};

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
  ["mock", "client", "opencode"].includes(provider)
    || provider === "claudecode"
    || provider === "codex"
    ? "openai-compatible"
    : provider;

const describeRepositoryWriteMode = (
  repositoryWriteMode: NonNullable<SetupOptions["repositoryWriteMode"]>
): string =>
  repositoryWriteMode === "allow-write"
    ? "enabled by default"
    : "dry-run only by default";

const normalizeTomlTableName = (value: string): string =>
  value.replace(/["'\s]/gu, "");

const CODEX_MCP_TABLE = 'mcp_servers.mcp-code-worker';
const CODEX_MCP_ENV_TABLE = `${CODEX_MCP_TABLE}.env`;

const inspectCodexMcpConfig = async (
  codexConfigPath: string
): Promise<CodexMcpConfigUpdateResult> => {
  try {
    await readFile(codexConfigPath, "utf8");

    return {
      exists: true,
      path: codexConfigPath,
      status: "not-requested"
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        path: codexConfigPath,
        status: "not-requested"
      };
    }

    throw error;
  }
};

const stripCodexMcpSections = (contents: string, newline: string): string => {
  const lines = contents.split(/\r?\n/u);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[(?<name>.+?)\]\s*$/u);

    if (tableMatch?.groups?.name) {
      const tableName = normalizeTomlTableName(tableMatch.groups.name);
      const isTargetTable =
        tableName === CODEX_MCP_TABLE || tableName === CODEX_MCP_ENV_TABLE;

      skipping = isTargetTable;

      if (isTargetTable) {
        continue;
      }
    }

    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join(newline).trimEnd();
};

const updateCodexMcpConfig = async (
  codexConfigPath: string,
  requested: boolean
): Promise<CodexMcpConfigUpdateResult> => {
  if (!requested) {
    return inspectCodexMcpConfig(codexConfigPath);
  }

  const inspection = await inspectCodexMcpConfig(codexConfigPath);

  if (!inspection.exists) {
    return {
      ...inspection,
      status: "missing-file"
    };
  }

  let contents: string;

  try {
    contents = await readFile(codexConfigPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        path: codexConfigPath,
        status: "missing-file"
      };
    }

    throw error;
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const renderedSnippet = renderMcpConfigSnippet({ host: "codex" }).replaceAll(
    "\n",
    newline
  );
  const withoutExistingEntry = stripCodexMcpSections(contents, newline);
  const nextContents = [
    withoutExistingEntry,
    renderedSnippet
  ]
    .filter((value) => value.trim().length > 0)
    .join(`${newline}${newline}`)
    .trimEnd()
    .concat(newline);

  await writeFile(codexConfigPath, nextContents, "utf8");

  return {
    exists: true,
    path: codexConfigPath,
    status: "written"
  };
};

const buildInitPaths = (rootDir: string): InitResult["paths"] => {
  const cwHomeDir = getCwHomeDir();
  const cwStorageDir = getCwWorkspaceDir(rootDir);
  const cwConfigPath = getCwConfigPath(rootDir);

  return {
    codexConfigPath: resolve(homedir(), ".codex", "config.toml"),
    cwConfigDir: dirname(cwConfigPath),
    cwConfigPath,
    cwHomeDir,
    cwStorageDir,
    globalAgentsPath: resolve(homedir(), ".codex", "AGENTS.md"),
    projectAgentsPath: resolve(rootDir, "AGENTS.md")
  };
};

const buildInitTips = (
  result: Pick<InitResult, "codexMcpConfig" | "enableMcp" | "paths" | "rootDir">
): string[] => [
  `Edit ${result.paths.cwConfigPath} manually if you need to tweak worker model settings or MCP-related runtime state.`,
  `Put project-only instructions in ${result.paths.projectAgentsPath}; put global Codex defaults in ${result.paths.globalAgentsPath}.`,
  result.codexMcpConfig.status === "written"
    ? `Updated the Codex MCP entry in ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)} through the explicit opt-in flow.`
    : result.codexMcpConfig.status === "missing-file"
      ? `Codex MCP opt-in was requested, but ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)} was not found. Create that file manually and paste \`cw mcp config --host codex\`.`
      : !result.codexMcpConfig.exists
        ? `No Codex user config was detected at ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)}. If Codex is your host, create that file manually and paste \`cw mcp config --host codex\`; if you use another host such as OpenCode or Claude Desktop, configure that host instead.`
      : result.enableMcp
        ? `If Codex is your MCP host, paste \`cw mcp config --host codex\` into ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)}.`
        : `When you are ready to wire Codex MCP, paste \`cw mcp config --host codex\` into ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)}.`,
  "Use `cw init` again when you want to revisit worker verification depth or onboarding defaults."
];

const DEFAULT_INIT_WORKER: SetupWorkerSummary = {
  benchmarkWorker: false,
  configured: false,
  interviewWorker: false,
  isDefault: false,
  probeWorker: false,
  registerWorker: false,
  workerId: "",
  workerMode: undefined,
  workerModel: "",
  workerProvider: ""
};

const formatWorkerStepStatus = (
  status: SetupStepStatus | undefined,
  enabled: boolean
): string =>
  status === "needs-input"
    ? "unavailable"
    : status ?? (enabled ? "planned" : "skipped");

const formatWorkerSummary = (result: InitResult["worker"]): string => {
  const workers = [
    result,
    ...result.additionalWorkers
  ].filter(
    (worker): worker is SetupWorkerSummary => Boolean(worker.workerId) && Boolean(worker.workerProvider) && Boolean(worker.workerModel)
  );

  if (workers.length === 0) {
    return "skipped";
  }

  return workers
    .map((worker) =>
      [
        worker.isDefault ? "primary" : "extra",
        `${worker.workerId} (${worker.workerProvider}/${worker.workerModel})`,
        `configured=${worker.configured ? "yes" : "no"}`,
        `registered=${formatWorkerStepStatus(worker.registerStatus, worker.registerWorker)}`,
        `probed=${formatWorkerStepStatus(worker.probeStatus, worker.probeWorker)}`,
        `interviewed=${formatWorkerStepStatus(worker.interviewStatus, worker.interviewWorker)}`,
        `benchmarked=${formatWorkerStepStatus(worker.benchmarkStatus, worker.benchmarkWorker)}`,
        worker.readinessStatus
          ? [
              `readiness=${worker.readinessStatus}`,
              worker.readinessUnavailableReasonType &&
              worker.readinessUnavailableReasonType !== "not-applicable"
                ? `(${worker.readinessUnavailableReasonType})`
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
  const codexHostConfigSummary =
    result.codexMcpConfig.status === "written"
      ? "updated via explicit opt-in"
      : result.codexMcpConfig.status === "missing-file"
        ? "not found; create it manually and paste cw mcp config --host codex"
        : !result.codexMcpConfig.exists
          ? "not detected; create it manually only if Codex is your host"
        : "cw mcp config --host codex";
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
    `codex host config: ${formatDisplayPath(result.rootDir, result.paths.codexConfigPath)} | ${codexHostConfigSummary}`,
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

const hasScriptedSetupInputs = (options: InitOptions): boolean =>
  options.allowWrite ||
  options.benchmarkWorker ||
  options.disableValidationAutoDiscover ||
  options.interviewWorker ||
  options.probeWorker ||
  options.registerWorker ||
  options.writeCodexMcpConfig ||
  options.typecheckScript.length > 0 ||
  options.lintScript.length > 0 ||
  options.testScript.length > 0 ||
  options.repositoryWriteMode !== undefined ||
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
  codexMcpConfig: CodexMcpConfigUpdateResult;
  enableMcp: boolean;
  setup: SetupOptions;
}> => {
  const initialRoot = normalizeFileSystemPath(options.root ?? process.cwd());
  const rootDir = normalizeFileSystemPath(
    await prompter.text("Workspace root?", {
      defaultValue: initialRoot
    })
  );
  const paths = buildInitPaths(rootDir);
  const codexMcpConfig = await inspectCodexMcpConfig(paths.codexConfigPath);
  const keepDryRun = await prompter.confirm(
    "Keep repository writes in dry-run mode by default?",
    true
  );
  const enableMcp = await prompter.confirm(
    codexMcpConfig.exists
      ? `Prepare an MCP config snippet for this workspace? Detected Codex config: ${formatDisplayPath(rootDir, paths.codexConfigPath)}`
      : `Prepare an MCP config snippet for this workspace? No Codex config was detected at ${formatDisplayPath(rootDir, paths.codexConfigPath)}, so cw will leave host wiring as a manual step unless you are using another MCP host.`,
    true
  );
  const configureWorker = await prompter.confirm(
    "Configure a primary worker now?",
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
  const reservedWorkerIds = new Set<string>();

  const promptWorkerPlan = async (
    isDefault: boolean
  ): Promise<InitWorkerPlan> => {
    const presetChoice = await prompter.select<InitPresetId | "custom">(
      isDefault ? "Primary worker preset?" : "Additional worker preset?",
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
      ["client", "opencode", "claudecode", "codex"].includes(selectedPreset?.workerProvider ?? "")
        ? "client"
        : "api";
    let workerProvider =
      selectedPreset?.workerProvider ??
      resolveApiProviderDefault(workerContext.workerModel.provider);
    let workerModel =
      selectedPreset?.workerModel ?? workerContext.workerModel.model;

    let baseUrl: string | undefined;
    let apiKey: string | undefined;

    if (!selectedPreset) {
      workerMode = await prompter.select(
        isDefault ? "Primary worker mode?" : "Additional worker mode?",
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
            !["mock", "client", "opencode", "claudecode", "codex"].includes(workerProvider))))
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
      !["mock", "client", "opencode", "claudecode", "codex"].includes(workerProvider)
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
        `Local client command? Leave blank to use ${workerProvider === "opencode" ? "opencode" : workerProvider === "claudecode" ? "claude" : workerProvider === "codex" ? "codex" : "sparkcode"}.`,
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
      ? "Primary worker name?"
      : "Additional worker name?";
    const suggestedWorkerId = isDefault
      ? "primary-worker"
      : `worker-${additionalWorkers.length + 1}`;
    let workerId = "";

    while (workerId.length === 0) {
      const candidate = await prompter.text(workerIdPrompt, {
        defaultValue: suggestedWorkerId
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

    const verificationDepth = await promptWorkerVerificationDepth(prompter);

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

    while (
      await prompter.confirm(
        "Register another worker? Only one worker handles a task at a time, but the host can switch workers between steps.",
        false
      )
    ) {
      const nextWorker = await promptWorkerPlan(false);
      additionalWorkers.push(nextWorker);
      reservedWorkerIds.add(nextWorker.workerId);
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

  setup.additionalWorkers = additionalWorkers;

  return {
    additionalWorkers,
    codexMcpConfig,
    enableMcp,
    setup
  };
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
    .option(
      "--write-codex-mcp-config",
      "Explicitly update ~/.codex/config.toml with the cw MCP server entry when that file already exists.",
      false
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

      if (options.writeCodexMcpConfig && !options.allowWrite) {
        throw new Error(
          "--write-codex-mcp-config requires --allow-write because it modifies a user-scoped Codex config file."
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
          workerBaseUrl: options.workerBaseUrl,
          workerClientCommand: options.workerClientCommand,
          workerId: options.workerId,
          workerModel: options.workerModel,
          workerProvider: options.workerProvider
        });
        const paths = buildInitPaths(result.rootDir);
        const codexMcpConfig = await updateCodexMcpConfig(
          paths.codexConfigPath,
          options.writeCodexMcpConfig
        );
        const output = {
          ...result,
          codexMcpConfig
        };

        writeOutput(io, output, formatSetupResult(output));
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
        const initWorkers = setup.workers;
        const primaryWorker =
          initWorkers.find((worker) => worker.isDefault) ??
          initWorkers[0] ??
          DEFAULT_INIT_WORKER;
        const additionalWorkerSummaries = initWorkers.filter(
          (worker) => !worker.isDefault
        );
        const paths = buildInitPaths(setup.rootDir);
        const writeCodexMcpConfig =
          collected.enableMcp &&
          applyNow &&
          collected.codexMcpConfig.exists &&
          await prompter.confirm(
            `Update the existing Codex MCP config now if ${formatDisplayPath(setup.rootDir, paths.codexConfigPath)} already exists?`,
            false
          );
        const codexMcpConfig = await updateCodexMcpConfig(
          paths.codexConfigPath,
          writeCodexMcpConfig
        );
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
          codexMcpConfig,
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
            codexMcpConfig,
            enableMcp: collected.enableMcp,
            rootDir: setup.rootDir,
            paths
          }),
          worker: {
            ...primaryWorker,
            additionalWorkers: additionalWorkerSummaries
          },
          workers: initWorkers
        };

        writeOutput(io, result, formatInitResult(result));
      } finally {
        await prompter.close?.();
      }
    });
};
