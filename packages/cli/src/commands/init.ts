import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";

import type { Command } from "commander";

import {
  resolveExecutionContext,
  type ModelConfig
} from "@mcp-code-worker/core";
import { runWorkerInterviewWorkflow } from "@mcp-code-worker/graph";
import {
  deriveWorkerRegistrationId,
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";
import { buildMcpConfigSnippet } from "./mcp.js";
import { runSetup, type SetupOptions, type SetupResult } from "./setup.js";

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

interface InitOptions {
  advanced: boolean;
  root?: string;
}

interface InitWorkerPlan {
  baseUrl?: string;
  interviewWorker: boolean;
  isDefault: boolean;
  registerWorker: boolean;
  workerId: string;
  workerMode: "api" | "client";
  workerModel: string;
  workerProvider: string;
}

interface InitWorkerSummary {
  interviewWorker: boolean;
  isDefault: boolean;
  registerWorker: boolean;
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
  repositoryWriteMode: NonNullable<SetupOptions["repositoryWriteMode"]>;
  rootDir: string;
  setup: SetupResult;
  worker: InitWorkerSummary & {
    additionalWorkers: InitWorkerSummary[];
  };
  workers: InitWorkerSummary[];
}

const toYesNoSuffix = (defaultValue: boolean): string =>
  defaultValue ? " [Y/n]" : " [y/N]";

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
    close: async () => {
      readline.close();
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
  ["mock", "client", "local-client"].includes(provider)
    ? "openai-compatible"
    : provider;

const describeRepositoryWriteMode = (
  repositoryWriteMode: NonNullable<SetupOptions["repositoryWriteMode"]>
): string =>
  repositoryWriteMode === "allow-write"
    ? "enabled by default"
    : "dry-run only by default";

const formatWorkerSummary = (result: InitResult["worker"]): string => {
  const workers = [
    result,
    ...result.additionalWorkers
  ].filter(
    (worker): worker is InitWorkerSummary & { workerModel: string; workerProvider: string } =>
      Boolean(worker.workerProvider) && Boolean(worker.workerModel)
  );

  if (workers.length === 0) {
    return "skipped";
  }

  return workers
    .map((worker) =>
      [
        worker.isDefault ? "default" : "extra",
        `${worker.workerProvider}:${worker.workerModel}`,
        worker.interviewWorker ? "interview" : null
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
    `repository writes: ${describeRepositoryWriteMode(result.repositoryWriteMode)}`,
    `mcp: ${result.enableMcp ? "snippet prepared" : "skipped"}`,
    `workers: ${formatWorkerSummary(result.worker)}`,
    `setup: ${result.setup.status}`,
    `next: ${result.setup.recommendedActions.slice(0, 3).join(" | ") || "Run cw doctor"}`
  ];

  if (result.mcpConfig) {
    lines.push("mcp config snippet:");
    lines.push(JSON.stringify(result.mcpConfig, null, 2));
  }

  return lines;
};

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
  const initialRoot = resolve(options.root ?? process.cwd());
  const rootDir = resolve(
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
    disableValidationAutoDiscover: false,
    interviewWorker: false,
    lintScript: [],
    repositoryWriteMode: keepDryRun ? "dry-run" : "allow-write",
    root: rootDir,
    registerWorker: false,
    testScript: [],
    typecheckScript: [],
    workerBaseUrl: undefined,
    workerClientCommand: undefined,
    workerId: undefined,
    workerModel: undefined,
    workerProvider: undefined
  };
  const additionalWorkers: InitWorkerPlan[] = [];
  const workerSummaries: InitWorkerSummary[] = [];

  const promptWorkerPlan = async (
    isDefault: boolean
  ): Promise<InitWorkerPlan> => {
    const workerMode = await prompter.select(
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

    let workerProvider =
      workerMode === "client"
        ? "client"
        : resolveApiProviderDefault(workerContext.workerModel.provider);
    const workerModel = await prompter.text(
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

    let baseUrl: string | undefined;

    if (
      workerMode === "api" &&
      (options.advanced ||
        Boolean(workerContext.workerModel.baseURL) ||
        !["mock", "client", "local-client"].includes(workerProvider))
    ) {
      const promptedBaseUrl = await prompter.text(
        "Worker base URL? Leave blank to skip.",
        {
          allowEmpty: true,
          defaultValue: workerContext.workerModel.baseURL ?? ""
        }
      );
      baseUrl = promptedBaseUrl.length > 0 ? promptedBaseUrl : undefined;
    }

    if (
      isDefault &&
      workerMode === "client" &&
      (options.advanced || Boolean(workerContext.workerModel.clientCommand))
    ) {
      const promptedClientCommand = await prompter.text(
        "Local client command? Leave blank to use opencode.",
        {
          allowEmpty: true,
          defaultValue: workerContext.workerModel.clientCommand ?? ""
        }
      );
      setup.workerClientCommand =
        promptedClientCommand.length > 0 ? promptedClientCommand : undefined;
    }

    const interviewWorker = await prompter.confirm(
      "Interview and persist this worker profile now?",
      false
    );

    return {
      baseUrl,
      interviewWorker,
      isDefault,
      registerWorker: true,
      workerId: deriveWorkerRegistrationId({
        ...workerContext.workerModel,
        provider: workerProvider,
        model: workerModel,
        ...(baseUrl ? { baseURL: baseUrl } : {})
      }),
      workerMode,
      workerModel,
      workerProvider
    };
  };

  if (configureWorker) {
    const defaultWorker = await promptWorkerPlan(true);
    setup.workerBaseUrl = defaultWorker.baseUrl;
    setup.interviewWorker = defaultWorker.interviewWorker;
    setup.registerWorker = defaultWorker.registerWorker;
    setup.workerId = defaultWorker.workerId;
    setup.workerModel = defaultWorker.workerModel;
    setup.workerProvider = defaultWorker.workerProvider;
    workerSummaries.push({
      interviewWorker: defaultWorker.interviewWorker,
      isDefault: true,
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
      workerSummaries.push({
        interviewWorker: nextWorker.interviewWorker,
        isDefault: false,
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
        interviewWorker: false,
        isDefault: false,
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
): Promise<void> => {
  if (workers.length === 0) {
    return;
  }

  const context = await resolveExecutionContext({
    rootDir,
    cliOverrides: {
      allowWrite: true,
      dryRun: false
    }
  });

  for (const worker of workers) {
    const modelConfig: ModelConfig = {
      ...context.workerModel,
      provider: worker.workerProvider,
      model: worker.workerModel,
      baseURL: worker.baseUrl,
      apiKey: context.workerModel.apiKey
    };
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

    if (!worker.interviewWorker) {
      continue;
    }

    const interviewResult = await runWorkerInterviewWorkflow({
      context,
      workerId: worker.workerId,
      modelConfig
    });

    if (!interviewResult.persistenceAdvice.canPersist) {
      continue;
    }

    await saveWorkerProfile(context, interviewResult.profile, true);
  }
};

export const registerInitCommand = (
  program: Command,
  io: CliIo,
  injectedPrompter?: InitPrompter
): void => {
  program
    .command("init")
    .description("Run a Vue CLI-style onboarding flow for cw and persist the chosen local setup.")
    .option("--advanced", "Ask for additional worker and validation setup details.", false)
    .option("--root <path>", "Pre-fill the workspace root shown in the onboarding flow.")
    .action(async (options: InitOptions) => {
      if (!injectedPrompter && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        throw new Error(
          "cw init requires an interactive terminal. Use 'cw setup' for scripted setup."
        );
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
        if (applyNow) {
          await registerAdditionalWorkers(
            setup.rootDir,
            collected.additionalWorkers
          );
        }
        const result: InitResult = {
          advanced: options.advanced,
          applied: applyNow,
          enableMcp: collected.enableMcp,
          mcpConfig: collected.enableMcp
            ? buildMcpConfigSnippet()
            : undefined,
          repositoryWriteMode:
            collected.setup.repositoryWriteMode ?? "dry-run",
          rootDir: setup.rootDir,
          setup,
          worker: collected.worker,
          workers: collected.workers
        };

        writeOutput(io, result, formatInitResult(result));
      } finally {
        await prompter.close?.();
      }
    });
};
