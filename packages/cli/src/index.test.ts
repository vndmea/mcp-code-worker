import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildCli } from "@mcp-code-worker/cli";
import {
  getCwConfigPath,
  getCwWorkspaceAuditDir,
  getCwWorkspaceFilePath,
  getCwWorkspaceRunsDir,
  PatchProposalSchema
} from "@mcp-code-worker/core";
import type { InitPrompter } from "./commands/init.js";

const execFile = promisify(execFileCallback);

const createIo = (outputMode?: "human" | "json") => {
  const output: string[] = [];
  const errors: string[] = [];

  return {
    output,
    errors,
    io: {
      ...(outputMode ? { outputMode } : {}),
      write: (message: string) => {
        output.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      }
    }
  };
};

const createInitPrompter = (answers: Array<boolean | string>): InitPrompter => {
  let index = 0;

  const nextAnswer = (): boolean | string => {
    const answer = answers[index];

    if (answer === undefined) {
      throw new Error("Ran out of scripted init answers.");
    }

    index += 1;
    return answer;
  };

  return {
    confirm: () => {
      const answer = nextAnswer();

      if (typeof answer !== "boolean") {
        throw new Error(`Expected boolean init answer but received ${typeof answer}.`);
      }

      return Promise.resolve(answer);
    },
    select: <T extends string>() => {
      const answer = nextAnswer();

      if (typeof answer !== "string") {
        throw new Error(`Expected string init answer but received ${typeof answer}.`);
      }

      return Promise.resolve(answer as T);
    },
    text: () => {
      const answer = nextAnswer();

      if (typeof answer !== "string") {
        throw new Error(`Expected string init answer but received ${typeof answer}.`);
      }

      return Promise.resolve(answer);
    }
  };
};

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "cw-cli-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

const withTempHome = async (
  callback: (homeDir: string) => Promise<void>
): Promise<void> => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalHomeDrive = process.env.HOMEDRIVE;
  const originalHomePath = process.env.HOMEPATH;
  const homeDir = await mkdtemp(join(tmpdir(), "cw-home-"));

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  delete process.env.HOMEDRIVE;
  delete process.env.HOMEPATH;

  try {
    await callback(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalHomeDrive === undefined) {
      delete process.env.HOMEDRIVE;
    } else {
      process.env.HOMEDRIVE = originalHomeDrive;
    }

    if (originalHomePath === undefined) {
      delete process.env.HOMEPATH;
    } else {
      process.env.HOMEPATH = originalHomePath;
    }
  }
};

const parseLastJson = <T>(output: string[]): T =>
  JSON.parse(output.at(-1) ?? "{}") as T;

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const profilePath = getCwWorkspaceFilePath(rootDir, "worker-profiles.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify(profiles, null, 2),
    "utf8"
  );
};

const writeRegistry = async (rootDir: string, workers: unknown[]): Promise<void> => {
  const registryPath = getCwWorkspaceFilePath(rootDir, "workers.json");
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({ version: 1, workers }, null, 2),
    "utf8"
  );
};

const writeWorkspaceFixture = async (rootDir: string): Promise<void> => {
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await mkdir(join(rootDir, "tmp"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify(
      {
        scripts: {
          build: "node -e \"process.exit(0)\"",
          typecheck: "node -e \"process.exit(0)\"",
          lint: "node -e \"process.exit(0)\"",
          test: "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 1;\n",
    "utf8"
  );
  await writeFile(
    join(rootDir, "tmp", "error.log"),
    "TS2304: Cannot find name 'missingValue'.\n",
    "utf8"
  );
};

const writeCwConfig = async (rootDir: string, config: Record<string, unknown>): Promise<void> => {
  const configPath = getCwConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        ...config
      },
      null,
      2
    ),
    "utf8"
  );
};

const writeCodexConfig = async (
  homeDir: string,
  config: {
    args: string[];
    command: string;
    env?: Record<string, string>;
  }
): Promise<void> => {
  const codexDir = join(homeDir, ".codex");
  const codexConfigPath = join(codexDir, "config.toml");
  const envEntries = Object.entries(config.env ?? {});
  const envBlock =
    envEntries.length > 0
      ? [
          "",
          `[mcp_servers."mcp-code-worker".env]`,
          ...envEntries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
        ].join("\n")
      : "";
  const contents = [
    `[mcp_servers."mcp-code-worker"]`,
    `command = ${JSON.stringify(config.command)}`,
    `args = ${JSON.stringify(config.args)}`,
    envBlock
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  await mkdir(codexDir, { recursive: true });
  await writeFile(codexConfigPath, contents, "utf8");
};

const initGitRepo = async (rootDir: string): Promise<void> => {
  await execFile("git", ["init"], { cwd: rootDir });
  await execFile("git", ["config", "user.email", "cw@example.com"], { cwd: rootDir });
  await execFile("git", ["config", "user.name", "MCP Code Worker"], { cwd: rootDir });
  await execFile("git", ["add", "."], { cwd: rootDir });
  await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });
  await writeFile(
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 2;\n",
    "utf8"
  );
  await execFile("git", ["add", "packages/core/src/index.ts"], { cwd: rootDir });
  await execFile("git", ["commit", "-m", "update"], { cwd: rootDir });
};

const writePatchProposalFile = async (rootDir: string): Promise<void> => {
  const targetPath = join(rootDir, "packages", "core", "src", "index.ts");
  const originalContents = "export const value = 2;\n";
  await writeFile(targetPath, `// comment\n${originalContents}`, "utf8");
  const diff = await execFile("git", ["diff", "--", "packages/core/src/index.ts"], {
    cwd: rootDir
  });
  await writeFile(targetPath, originalContents, "utf8");
  const proposal = PatchProposalSchema.parse({
    id: "patch-1",
    title: "Add a candidate comment",
    summary: "Insert a comment above the export.",
    rationale: ["Used by CLI patch tests."],
    unifiedDiff: diff.stdout,
    files: [
      {
        path: "packages/core/src/index.ts",
        changeType: "modify",
        summary: "Insert a candidate comment.",
        riskLevel: "low"
      }
    ],
    risks: [],
    validationPlan: ["pnpm typecheck"],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-proposal-workflow"
    }
  });

  await writeFile(
    join(rootDir, "tmp", "candidate.patch"),
    JSON.stringify(proposal, null, 2),
    "utf8"
  );
};

const createRegistration = (overrides: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();

  return {
    workerId: "mock:registered-worker",
    provider: "mock",
    model: "registered-worker",
    enabled: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
};

const createProfile = (overrides: Record<string, unknown> = {}) => ({
  workerId: "mock:gpt-5.4-mini",
  provider: "mock",
  model: "gpt-5.4-mini",
  status: "qualified",
  supportedTaskTypes: [
    "summarization",
    "code-understanding",
    "log-analysis",
    "json-extraction",
    "review-lite",
    "risk-analysis",
    "codegen",
    "patch-generation",
    "test-generation",
    "validation-fix",
    "doc-generation"
  ],
  unsupportedTaskTypes: [],
  score: {
    instructionFollowing: 0.9,
    structuredOutput: 0.9,
    reasoning: 0.9,
    codeQuality: 0.9,
    domainKnowledge: 0.8,
    reliability: 0.9
  },
  risks: [],
  warnings: [],
  routingPolicy: {
    maxTaskComplexity: "medium",
    requiresHostReview: false,
    allowCodegen: true,
    allowPatchGeneration: true,
    allowDomainTasks: true
  },
  evaluatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  suiteName: "default-worker-onboarding-suite",
  suiteVersion: "6",
  admission: {
    passed: true,
    blockingReasons: []
  },
  portrait: {
    scopeDiscipline: 0.83,
    repoGrounding: 0.81,
    answerDirectness: 0.8,
    codeUnderstanding: 0.79,
    fixPlanning: 0.8,
    implementationPlanning: 0.82,
    consistency: 0.86
  },
  taskScores: {
    summarization: 0.8,
    codeUnderstanding: 0.79,
    riskAnalysis: 0.8,
    reviewLite: 0.8,
    codegen: 0.82,
    patchGeneration: 0.81,
    testGeneration: 0.82,
    validationFix: 0.82,
    logAnalysis: 0.79,
    jsonExtraction: 0.78,
    docGeneration: 0.8
  },
  evidence: {
    failedCases: [],
    repoGroundedCases: ["structured-output", "scope-discipline", "summarization"],
    fallbackPatternCases: [],
    genericAnswerCases: []
  },
  ...overrides
});

describe("cli parsing", () => {
  it("runs models list", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "cw", "models", "list"]);

    expect(output.join("\n")).toContain("\"role\": \"worker\"");
  });

  it("lists mcp tools", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "cw", "mcp", "list-tools"]);

    expect(output.join("\n")).toContain("cw_run_host_worker");
    expect(output.join("\n")).toContain("cw_list_tools");
  });

  it("prints a generic mcp config snippet", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "cw", "mcp", "config"]);

    expect(output.join("\n")).toContain("\"mcp-code-worker\"");
    expect(output.join("\n")).toContain("\"mcp\"");
    expect(output.join("\n")).toContain("\"serve\"");
  });

  it("describes mcp serve as a host-connected stdio session", () => {
    const cli = buildCli();
    const mcpCommand = cli.commands.find((command) => command.name() === "mcp");
    const serveCommand = mcpCommand?.commands.find(
      (command) => command.name() === "serve"
    );

    expect(serveCommand?.description()).toContain("connected host session");
    expect(serveCommand?.description()).toContain("stdio closes");
  });

  it("prints a minimal mcp config snippet for codex", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "cw", "mcp", "config", "--host=codex"]);

    expect(output.join("\n")).toContain('[mcp_servers."mcp-code-worker"]');
    expect(output.join("\n")).toContain('args = ["mcp", "serve"]');
    expect(output.join("\n")).not.toContain("\"mcpServers\"");
  });

  it("prints the same minimal mcp config snippet when a host preset is selected", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync([
      "node",
      "cw",
      "mcp",
      "config",
      "--host",
      "vscode"
    ]);

    const config = parseLastJson<{
      mcpServers?: {
        "mcp-code-worker"?: {
          args?: string[];
        };
      };
    }>(output);

    expect(config.mcpServers?.["mcp-code-worker"]?.args).toEqual(["mcp", "serve"]);
    expect(output.join("\n")).not.toContain("\"env\":");
  });

  it("runs worker list", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "cw", "worker", "list"]);

    expect(output.join("\n")).toContain("[");
  });

  it("runs doctor and returns structured JSON", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);

      const report = JSON.parse(output.join("\n")) as {
        checks: Array<{ name: string }>;
        workerAvailability?: unknown;
      };

      expect(report.checks.some((check) => check.name === "worker-profile-store")).toBe(true);
      expect(report.checks.some((check) => check.name === "worker-registry")).toBe(true);
      expect(report.workerAvailability).toBeUndefined();
      expect(output.join("\n")).not.toContain("\"host-config-present\"");
    });
  });

  it("includes worker readiness in doctor only when an explicit worker is requested", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(
        rootDir,
        [
          createProfile({
            workerId: "default-worker"
          })
        ]
      );
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor", "--worker", "default-worker"]);

      const report = JSON.parse(output.join("\n")) as {
        nextCommand?: { command?: string };
        workerAvailability?: { workerId: string };
      };

      expect(report.workerAvailability?.workerId).toBe("default-worker");
      expect(report.nextCommand?.command).toContain(
        "cw worker register --worker default-worker"
      );
    });
  });

  it("renders doctor in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);

      expect(output.at(-1)).toContain("cw doctor:");
      expect(output.at(-1)).toContain("binding:");
      expect(output.at(-1)).toContain("paths:");
      expect(output.at(-1)).toContain("worker:");
      expect(output.at(-1)).toContain("\u001b[");
      expect(output.at(-1)).not.toContain("\"checks\"");
    });
  });

  it("keeps doctor json output unstyled", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);

      expect(output.at(-1)).toContain("\"checks\"");
      expect(output.at(-1)).not.toContain("\u001b[");
    });
  });

  it("reports local client compatibility warnings when the resolved command is not local-client-compatible", async () => {
    await withTempCwd(async (rootDir) => {
      await writeCwConfig(rootDir, {
        workerClientCommand: "node",
        workerModel: {
          provider: "client",
          model: "qwen3-coder"
        }
      });
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);

      expect(output.at(-1)).toContain("\"local-client-compatibility\"");
      expect(output.at(-1)).toContain("missing expected flags");
      expect(output.at(-1)).toContain("\"configuredCommand\": \"node\"");
      expect(output.at(-1)).toContain("\"resolvedCommand\":");
    });
  });

  it("renders resolved local client details in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeCwConfig(rootDir, {
        workerClientCommand: "node",
        workerModel: {
          provider: "client",
          model: "qwen3-coder"
        }
      });
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);

      expect(output.at(-1)).toContain("local client:");
      expect(output.at(-1)).toContain("configured=node");
      expect(output.at(-1)).toContain("resolved=");
      expect(output.at(-1)).toContain("source=configured");
    });
  });

  it("runs scripted init and returns the minimal success path", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "init"]);

      const result = parseLastJson<{
        minimalSuccessPath: string[];
        recommendedEntrypoints: Array<{ command: string }>;
        steps: Array<{ id: string }>;
      }>(output);

      expect(result.minimalSuccessPath.length).toBeGreaterThan(0);
      expect(result.recommendedEntrypoints.length).toBeGreaterThan(0);
      expect(result.steps.some((step) => step.id === "readiness-summary")).toBe(true);
    });
  });

  it("can apply scripted init and run the full worker verification flow", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "init",
        "--worker-provider",
        "mock",
        "--worker-model",
        "setup-worker",
        "--worker-id",
        "primary-worker",
        "--worker-api-key",
        "setup-secret",
        "--worker-client-command",
        "node",
        "--register-worker",
        "--probe-worker",
        "--interview-worker",
        "--benchmark-worker",
        "--typecheck-script",
        "check-types",
        "--lint-script",
        "lint:ci",
        "--allow-write"
      ]);

      const result = parseLastJson<{
        mode: string;
        steps: Array<{ id: string; status: string }>;
      }>(output);

      expect(result.mode).toBe("execute");
      expect(
        result.steps.some(
          (step) => step.id === "register-worker" && step.status === "completed"
        )
      ).toBe(true);
      expect(
        result.steps.some(
          (step) => step.id === "probe-worker" && step.status === "completed"
        )
      ).toBe(true);
      expect(
        result.steps.some(
          (step) => step.id === "interview-worker" && step.status === "completed"
        )
      ).toBe(true);
      expect(
        result.steps.some(
          (step) => step.id === "benchmark-worker" && step.status === "completed"
        )
      ).toBe(true);

      const savedConfig = JSON.parse(
        await readFile(getCwConfigPath(rootDir), "utf8")
      ) as {
        workerClientCommand?: string;
        workerModel?: { apiKey?: string; model?: string };
        validation?: {
          scripts?: {
            lint?: string[];
            typecheck?: string[];
          };
        };
      };
      const savedRegistry = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "workers.json"), "utf8")
      ) as {
        workers: Array<{ workerId: string }>;
      };
      const savedProfiles = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{ workerId: string }>;

      expect(savedConfig.workerModel?.model).toBe("setup-worker");
      expect(savedConfig.workerModel?.apiKey).toBe("setup-secret");
      expect(savedConfig.workerClientCommand).toBe("node");
      expect(savedConfig.validation?.scripts?.typecheck).toContain("check-types");
      expect(savedConfig.validation?.scripts?.lint).toContain("lint:ci");
      expect(savedRegistry.workers.some((worker) => worker.workerId === "primary-worker")).toBe(
        true
      );
      expect(savedProfiles.some((profile) => profile.workerId === "primary-worker")).toBe(
        true
      );
    });
  });

  it("uses the configured local client path during init probe workflows", async () => {
    await withTempCwd(async () => {
      const { io, output } = createIo();
      const cli = buildCli(io);
      const clientCommand = process.execPath;

      await cli.parseAsync([
        "node",
        "cw",
        "init",
        "--worker-provider",
        "client",
        "--worker-model",
        "deepseek-v4-flash",
        "--worker-id",
        "local-worker",
        "--worker-client-command",
        clientCommand,
        "--register-worker",
        "--probe-worker",
        "--allow-write"
      ]);

      const result = parseLastJson<{
        readiness?: {
          checks?: {
            probe?: {
              detail?: string;
            };
          };
        };
        steps: Array<{
          id: string;
          details?: {
            clientCommand?: string;
            configuredCommand?: string;
            resolvedCommand?: string;
            resolvedPath?: string | null;
          };
        }>;
      }>(output);

      expect(result.readiness?.checks?.probe?.detail).toContain(clientCommand);
      expect(result.readiness?.checks?.probe?.detail).not.toContain("sparkcode ENOENT");
    });
  });

  it("rejects scripted init when an explicit local client path does not exist", async () => {
    await withTempCwd(async () => {
      const { io } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync([
          "node",
          "cw",
          "init",
          "--worker-client-command",
          "./missing/sparkcode.exe"
        ])
      ).rejects.toThrow("was not found");
    });
  });

  it("runs init and persists a dry-run-first onboarding config", async () => {
    await withTempHome(async () => {
      await withTempCwd(async (rootDir) => {
        const { io, output } = createIo();
        let openedPath: string | null = null;
        const cli = buildCli(io, {
          initPrompter: createInitPrompter([
            rootDir,
            true,
            true,
            false,
            true,
            true
          ]),
          pathOpener: (targetPath: string) => {
            openedPath = targetPath;
            return Promise.resolve(true);
          }
        });

        await cli.parseAsync(["node", "cw", "init"]);

        const result = parseLastJson<{
          applied: boolean;
          codexMcpConfig: { exists: boolean; status: string };
          mcpConfig?: { mcpServers?: Record<string, unknown> };
          openedConfigDirectory: boolean;
          paths: {
            codexConfigPath: string;
            cwConfigDir: string;
            cwConfigPath: string;
            globalAgentsPath: string;
            projectAgentsPath: string;
          };
          repositoryWriteMode: string;
          setup: { mode: string };
          tips: string[];
        }>(output);
        const savedConfig = JSON.parse(
          await readFile(getCwConfigPath(rootDir), "utf8")
        ) as {
          safety?: {
            allowWrite?: boolean;
            dryRun?: boolean;
          };
        };

        expect(result.applied).toBe(true);
        expect(result.repositoryWriteMode).toBe("dry-run");
        expect(result.setup.mode).toBe("execute");
        expect(result.codexMcpConfig.exists).toBe(false);
        expect(result.codexMcpConfig.status).toBe("not-requested");
        expect(result.mcpConfig?.mcpServers?.["mcp-code-worker"]).toBeTruthy();
        expect(result.openedConfigDirectory).toBe(true);
        expect(result.paths.cwConfigPath).toContain("config.json");
        expect(result.paths.codexConfigPath).toContain("config.toml");
        expect(result.paths.projectAgentsPath).toContain("AGENTS.md");
        expect(result.paths.globalAgentsPath).toContain(".codex");
        expect(result.tips[0]).toContain("config.json");
        expect(
          result.tips.some((tip) => tip.includes("No Codex user config was detected"))
        ).toBe(true);
        expect(openedPath).toBe(result.paths.cwConfigDir);
        expect(savedConfig.safety?.dryRun).toBe(true);
        expect(savedConfig.safety?.allowWrite).toBe(false);
      });
    });
  });

  it("reminds scripted init users about the codex user config path in human output", async () => {
    await withTempHome(async () => {
      await withTempCwd(async (rootDir) => {
        const { io, output } = createIo("human");
        const cli = buildCli(io);

        await cli.parseAsync(["node", "cw", "init", "--allow-write"]);

        expect(output.at(-1)).toContain("codex host config:");
        expect(output.at(-1)).toContain("~/.codex/config.toml");
        expect(output.at(-1)).toContain("not detected");
        expect(output.at(-1)).toContain(rootDir);
      });
    });
  });

  it("updates an existing codex config only through the explicit scripted opt-in", async () => {
    await withTempHome(async (homeDir) => {
      await withTempCwd(async () => {
        await writeCodexConfig(homeDir, {
          command: "old-cw",
          args: ["old", "serve"]
        });
        const { io, output } = createIo();
        const cli = buildCli(io);

        await cli.parseAsync([
          "node",
          "cw",
          "init",
          "--allow-write",
          "--write-codex-mcp-config"
        ]);

        const result = parseLastJson<{
          codexMcpConfig: { exists: boolean; status: string };
        }>(output);
        const contents = await readFile(join(homeDir, ".codex", "config.toml"), "utf8");

        expect(result.codexMcpConfig.exists).toBe(true);
        expect(result.codexMcpConfig.status).toBe("written");
        expect(contents).toContain('command = "cw"');
        expect(contents).toContain('args = ["mcp", "serve"]');
        expect(contents).not.toContain('command = "old-cw"');
      });
    });
  });

  it("can preview init worker choices without writing files", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const cli = buildCli(io, {
        initPrompter: createInitPrompter([
          rootDir,
          false,
          false,
          true,
          "custom",
          "api",
          "guided-worker",
          "mock",
          "primary-worker",
          "skip",
          true,
          false,
          false
        ])
      });

      await cli.parseAsync(["node", "cw", "init"]);

      const result = parseLastJson<{
        applied: boolean;
        enableMcp: boolean;
        setup: { mode: string };
        worker: {
          registerWorker: boolean;
          workerModel?: string;
          workerProvider?: string;
        };
      }>(output);

      expect(result.applied).toBe(false);
      expect(result.enableMcp).toBe(false);
      expect(result.setup.mode).toBe("dry-run");
      expect(result.worker.registerWorker).toBe(true);
      expect(result.worker.workerProvider).toBe("mock");
      expect(result.worker.workerModel).toBe("guided-worker");
      await expect(readFile(getCwConfigPath(rootDir), "utf8")).rejects.toThrow();
    });
  });

  it("warns before skipping worker qualification and re-prompts when the user declines", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const confirmMessages: string[] = [];
      const confirmAnswers = [true, false, true, false, false, true, false];
      const selectAnswers = ["mock", "skip", "full"];
      const textAnswers = [rootDir, "primary-worker"];
      const cli = buildCli(io, {
        initPrompter: {
          confirm: (message: string) => {
            confirmMessages.push(message);
            return Promise.resolve(confirmAnswers.shift() ?? false);
          },
          select: <T extends string>() =>
            Promise.resolve(selectAnswers.shift() as T),
          text: () => Promise.resolve(textAnswers.shift() ?? ""),
          close: () => undefined
        }
      });

      await cli.parseAsync(["node", "cw", "init"]);

      const result = parseLastJson<{
        applied: boolean;
        worker: {
          benchmarkWorker: boolean;
          interviewWorker: boolean;
          probeWorker: boolean;
        };
      }>(output);

      expect(
        confirmMessages.some((message) =>
          message.includes("This skips probe, interview, and benchmark.")
        )
      ).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.worker.probeWorker).toBe(true);
      expect(result.worker.interviewWorker).toBe(true);
      expect(result.worker.benchmarkWorker).toBe(true);
    });
  });

  it("warns before probe-only verification and keeps the partial qualification when confirmed", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const confirmMessages: string[] = [];
      const confirmAnswers = [true, false, true, true, false, true, false];
      const selectAnswers = ["mock", "probe-only"];
      const textAnswers = [rootDir, "primary-worker"];
      const cli = buildCli(io, {
        initPrompter: {
          confirm: (message: string) => {
            confirmMessages.push(message);
            return Promise.resolve(confirmAnswers.shift() ?? false);
          },
          select: <T extends string>() =>
            Promise.resolve(selectAnswers.shift() as T),
          text: () => Promise.resolve(textAnswers.shift() ?? ""),
          close: () => undefined
        }
      });

      await cli.parseAsync(["node", "cw", "init"]);

      const result = parseLastJson<{
        applied: boolean;
        worker: {
          benchmarkWorker: boolean;
          interviewWorker: boolean;
          probeWorker: boolean;
        };
      }>(output);

      expect(
        confirmMessages.some((message) =>
          message.includes("This only runs a connectivity probe.")
        )
      ).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.worker.probeWorker).toBe(true);
      expect(result.worker.interviewWorker).toBe(false);
      expect(result.worker.benchmarkWorker).toBe(false);
    });
  });

  it("supports scripted init presets for common worker defaults", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "init",
        "--preset=deepseek",
        "--allow-write"
      ]);

      const result = parseLastJson<{
        mode: string;
        steps: Array<{ id: string; status: string }>;
      }>(output);
      const savedConfig = JSON.parse(
        await readFile(getCwConfigPath(rootDir), "utf8")
      ) as {
        workerModel?: {
          baseURL?: string;
          model?: string;
          provider?: string;
        };
      };

      expect(result.mode).toBe("execute");
      expect(
        result.steps.some(
          (step) => step.id === "configure-models" && step.status === "completed"
        )
      ).toBe(true);
      expect(savedConfig.workerModel?.provider).toBe("openai-compatible");
      expect(savedConfig.workerModel?.model).toBe("deepseek-v4-flash");
      expect(savedConfig.workerModel?.baseURL).toBe("https://api.deepseek.com");
    });
  });

  it("can apply init and register additional workers", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const cli = buildCli(io, {
        initPrompter: createInitPrompter([
          rootDir,
          true,
          false,
          true,
          "custom",
          "api",
          "primary-worker-model",
          "mock",
          "primary-worker",
          "skip",
          true,
          true,
          "custom",
          "api",
          "extra-worker",
          "mock",
          "extra-worker",
          "skip",
          true,
          false,
          true,
          false
        ])
      });

      await cli.parseAsync(["node", "cw", "init"]);

      const result = parseLastJson<{
        applied: boolean;
        worker: {
          additionalWorkers: Array<{ workerId?: string }>;
          workerId?: string;
        };
      }>(output);
      const savedConfig = JSON.parse(
        await readFile(getCwConfigPath(rootDir), "utf8")
      ) as {
        workerModel?: {
          model?: string;
          provider?: string;
        };
      };
      const savedRegistry = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "workers.json"), "utf8")
      ) as {
        workers: Array<{ workerId: string }>;
      };

      expect(result.applied).toBe(true);
      expect(result.worker.workerId).toBe("primary-worker");
      expect(result.worker.additionalWorkers[0]?.workerId).toBe("extra-worker");
      expect(savedConfig.workerModel?.provider).toBe("mock");
      expect(savedConfig.workerModel?.model).toBe("primary-worker-model");
      expect(savedRegistry.workers.map((worker) => worker.workerId)).toEqual(
        expect.arrayContaining(["primary-worker", "extra-worker"])
      );
    });
  });

  it("runs doctor with a live mock worker connectivity probe", async () => {
    await withTempCwd(async (rootDir) => {
      await writeCwConfig(rootDir, {
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor", "--probe"]);

      expect(output.at(-1)).toContain("\"worker-connectivity\"");
      expect(output.at(-1)).toContain("\"status\": \"pass\"");
    });
  });

  it("reports missing codex MCP wiring through doctor --mcp", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);

      await withTempHome(async () => {
        const { io, output } = createIo();
        const cli = buildCli(io);

        await cli.parseAsync(["node", "cw", "doctor", "--mcp"]);

        const result = parseLastJson<{
          capabilities?: Array<{ name: string; status: string }>;
          checks?: Array<{ name: string; status: string }>;
          recommendedActions?: string[];
          status?: string;
          summary?: string;
        }>(output);

        expect(result.status).toBe("unavailable");
        expect(result.summary).toContain("do not validate codex host wiring");
        expect(
          result.checks?.some(
            (check) => check.name === "host-config-present" && check.status === "fail"
          )
        ).toBe(true);
        expect(
          result.capabilities?.some(
            (capability) =>
              capability.name === "host-mcp-integration" &&
              capability.status === "unavailable"
          )
        ).toBe(true);
        expect(
          result.recommendedActions?.some((action) =>
            action.includes("Treat 'cw mcp list-tools' and 'cw mcp config' as local runtime checks only")
          )
        ).toBe(true);
      });
    });
  });

  it("validates a codex-style MCP snippet through doctor --mcp", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);

      await withTempHome(async (homeDir) => {
        await writeCodexConfig(homeDir, {
          command: "cw",
          args: ["mcp", "serve"]
        });
        const { io, output } = createIo();
        const cli = buildCli(io);

        await cli.parseAsync(["node", "cw", "doctor", "--mcp", "--host", "codex"]);

        const result = parseLastJson<{
          checks?: Array<{ name: string; status: string }>;
        }>(output);

        expect(
          result.checks?.some(
            (check) => check.name === "host-config-valid" && check.status === "pass"
          )
        ).toBe(true);
      });
    });
  });

  it("renders doctor probe details in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeCwConfig(rootDir, {
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor", "--probe"]);

      expect(output.at(-1)).toContain("probe:");
      expect(output.at(-1)).toContain("provider=mock");
      expect(output.at(-1)).toContain("model=gpt-5.4-mini");
    });
  });

  it("recommends the shortest next command for a ready worker", async () => {
    await withTempCwd(async (rootDir) => {
      const workerId = "ready-worker";
      await writeCwConfig(rootDir, {
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      await writeRegistry(rootDir, [
        createRegistration({
          workerId,
          provider: "mock",
          model: "gpt-5.4-mini"
        })
      ]);
      await writeProfiles(
        rootDir,
        [
          createProfile({
            workerId
          })
        ]
      );
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor", "--worker", workerId]);

      const report = parseLastJson<{
        nextCommand?: { command?: string; reason?: string };
      }>(output);

      expect(report.nextCommand?.command).toBe(
        `cw task start --goal "Review this repository" --worker ${workerId}`
      );
      expect(report.nextCommand?.reason).toContain("shortest successful path");
    });
  });

  it("adds recommended usage summaries to worker profiles", async () => {
    await withTempCwd(async (rootDir) => {
      const profile = createProfile({
        workerId: "profile-worker"
      });
      await writeProfiles(rootDir, [profile]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "worker", "profile", "profile-worker"]);

      const result = parseLastJson<{
        recommendedSummary?: string;
        recommendedUses?: string[];
      }>(output);

      expect(result.recommendedSummary).toContain("Recommended for");
      expect(result.recommendedUses).toContain("review and code understanding");
    });
  });

  it("surfaces denied patch reasons at the summary top level", async () => {
    await withTempCwd(async (rootDir) => {
      const workerId = "blocked-patch-worker";
      await writeRegistry(rootDir, [
        createRegistration({
          workerId,
          provider: "mock",
          model: "gpt-5.4-mini"
        })
      ]);
      await writeProfiles(
        rootDir,
        [
          createProfile({
            workerId,
            supportedTaskTypes: [
              "summarization",
              "code-understanding",
              "log-analysis",
              "json-extraction",
              "review-lite",
              "risk-analysis",
              "codegen",
              "test-generation",
              "validation-fix",
              "doc-generation"
            ],
            routingPolicy: {
              ...createProfile().routingPolicy,
              allowPatchGeneration: false
            }
          })
        ]
      );
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "propose",
        "--goal",
        "Fix typecheck",
        "--worker",
        workerId,
        "--require-profile",
        "--summary"
      ]);

      const summary = parseLastJson<{
        deniedReason?: string;
        humanSummary?: string;
        proposalState?: string;
      }>(output);

      expect(summary.deniedReason).toContain("not qualified for patch-generation tasks");
      expect(summary.humanSummary).toContain("placeholder only");
      expect(summary.proposalState).toBe("placeholder");
    });
  });

  it("manages worker registry entries", async () => {
    await withTempCwd(async () => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "register",
        "--worker",
        "mock:registered-worker",
        "--provider",
        "mock",
        "--model",
        "registered-worker"
      ]);
      expect(output.join("\n")).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "register",
        "--worker",
        "mock:registered-worker",
        "--provider",
        "mock",
        "--model",
        "registered-worker",
        "--tag",
        "coding",
        "--allow-write"
      ]);
      await cli.parseAsync(["node", "cw", "worker", "registry", "list"]);
      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "registry",
        "get",
        "mock:registered-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:registered-worker\"");
      expect(output.join("\n")).toContain("\"tags\"");

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "unregister",
        "mock:registered-worker"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "unregister",
        "mock:registered-worker",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"removed\": true");
    });
  });

  it("interviews registered workers and rejects unknown worker-only interviews", async () => {
    await withTempCwd(async (rootDir) => {
      await writeRegistry(rootDir, [
        createRegistration(),
        createRegistration({
          workerId: "mock:manual-worker",
          model: "manual-worker"
        })
      ]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "interview",
        "--worker",
        "mock:registered-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:registered-worker\"");
      expect(output.join("\n")).toContain("\"model\": \"registered-worker\"");

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "interview",
        "--worker",
        "mock:manual-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:manual-worker\"");

      await expect(
        cli.parseAsync([
          "node",
          "cw",
          "worker",
          "interview",
          "--worker",
          "mock:unknown"
        ])
      ).rejects.toThrow("was not found in the worker registry");
    });
  });

  it("requires explicit worker ids for worker execution commands", async () => {
    await withTempCwd(async () => {
      const { io, errors } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync(["node", "cw", "worker", "interview"])
      ).rejects.toThrow('process.exit unexpectedly called with "1"');
      expect(errors.at(-1)).toContain("Usage: cw worker interview [options]");
      expect(errors.at(-1)).toContain("--worker <workerId>");

      await expect(
        cli.parseAsync([
          "node",
          "cw",
          "worker",
          "benchmark",
          "--suite",
          "coding-v1"
        ])
      ).rejects.toThrow('process.exit unexpectedly called with "1"');
      expect(errors.at(-1)).toContain("Usage: cw worker benchmark [options]");
      expect(errors.at(-1)).toContain("--worker <workerId>");

      await expect(
        cli.parseAsync(["node", "cw", "worker", "readiness"])
      ).rejects.toThrow('process.exit unexpectedly called with "1"');
      expect(errors.at(-1)).toContain("Usage: cw worker readiness [options]");
      expect(errors.at(-1)).toContain("--worker <workerId>");
    });
  });

  it("updates patch-generation capabilities only when explicitly requested during benchmarks", async () => {
    await withTempCwd(async (rootDir) => {
      await writeRegistry(rootDir, [createRegistration()]);
      await writeProfiles(rootDir, [
        createProfile({
          workerId: "mock:registered-worker",
          provider: "mock",
          model: "registered-worker",
          supportedTaskTypes: [
            "summarization",
            "log-analysis",
            "json-extraction",
            "review-lite",
            "codegen",
            "test-generation"
          ],
          unsupportedTaskTypes: ["patch-generation"],
          routingPolicy: {
            maxTaskComplexity: "medium",
            requiresHostReview: false,
            allowCodegen: true,
            allowPatchGeneration: false,
            allowDomainTasks: true
          }
        })
      ]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "benchmark",
        "--worker",
        "mock:registered-worker",
        "--suite",
        "coding-v1",
        "--save"
      ]);

      let savedProfiles = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{
        routingPolicy?: { allowPatchGeneration?: boolean };
        supportedTaskTypes?: string[];
      }>;
      expect(output.at(-1)).toContain("\"capabilityUpdateApplied\": false");
      expect(output.at(-1)).toContain("\"patchGenerationQualified\": true");
      expect(savedProfiles[0]?.supportedTaskTypes).not.toContain("patch-generation");
      expect(savedProfiles[0]?.routingPolicy?.allowPatchGeneration).toBe(false);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "benchmark",
        "--worker",
        "mock:registered-worker",
        "--suite",
        "coding-v1",
        "--save",
        "--update-profile-capabilities"
      ]);

      savedProfiles = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{
        routingPolicy?: { allowPatchGeneration?: boolean };
        supportedTaskTypes?: string[];
      }>;
      expect(output.at(-1)).toContain("\"capabilityUpdateApplied\": true");
      expect(savedProfiles[0]?.supportedTaskTypes).toContain("patch-generation");
      expect(savedProfiles[0]?.routingPolicy?.allowPatchGeneration).toBe(true);
    });
  });

  it("preserves benchmark-driven patch capability when interview profiles are re-saved", async () => {
    await withTempCwd(async (rootDir) => {
      await writeRegistry(rootDir, [createRegistration()]);
      await writeProfiles(rootDir, [
        createProfile({
          workerId: "mock:registered-worker",
          provider: "mock",
          model: "registered-worker",
          supportedTaskTypes: [
            "summarization",
            "log-analysis",
            "json-extraction",
            "review-lite",
            "codegen",
            "test-generation"
          ],
          unsupportedTaskTypes: ["patch-generation"],
          routingPolicy: {
            maxTaskComplexity: "medium",
            requiresHostReview: false,
            allowCodegen: true,
            allowPatchGeneration: false,
            allowDomainTasks: true
          },
          evaluationSummary: {
            suiteName: "coding-v1",
            suiteVersion: "2",
            sampleCount: 4,
            passedCount: 3,
            failedCount: 1,
            confidenceBand: "medium",
            knownFailureModes: ["The worker omitted lint from the required checks."]
          }
        })
      ]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "interview",
        "--worker",
        "mock:registered-worker",
        "--save"
      ]);

      const savedProfiles = JSON.parse(
        await readFile(getCwWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{
        evaluationSummary?: { suiteName?: string };
        routingPolicy?: { allowPatchGeneration?: boolean };
        supportedTaskTypes?: string[];
        unsupportedTaskTypes?: string[];
      }>;
      const savedProfile = savedProfiles[0];
      const result = parseLastJson<{
        profile: {
          evaluationSummary?: { suiteName?: string };
          routingPolicy?: { allowPatchGeneration?: boolean };
          supportedTaskTypes?: string[];
          unsupportedTaskTypes?: string[];
        };
        warnings: string[];
      }>(output);

      expect(savedProfile?.routingPolicy?.allowPatchGeneration).toBe(false);
      expect(savedProfile?.supportedTaskTypes).not.toContain("patch-generation");
      expect(savedProfile?.unsupportedTaskTypes).toContain("patch-generation");
      expect(savedProfile?.evaluationSummary?.suiteName).toBe("coding-v1");
      expect(result.profile.routingPolicy?.allowPatchGeneration).toBe(false);
      expect(result.profile.supportedTaskTypes).not.toContain("patch-generation");
      expect(result.warnings.join("\n")).toContain(
        "Preserved benchmark-derived patch-generation capability"
      );
    });
  });

  it("reports unified worker readiness and can run an optional live probe", async () => {
    await withTempCwd(async (rootDir) => {
      const workerId = "readiness-worker";
      await writeCwConfig(rootDir, {
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      await writeRegistry(rootDir, [
        createRegistration({
          workerId,
          provider: "mock",
          model: "gpt-5.4-mini"
        })
      ]);
      await writeProfiles(rootDir, [
        createProfile({
          workerId
        })
      ]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "readiness",
        "--worker",
        workerId
      ]);

      const readiness = parseLastJson<{
        unavailableReasonType: string;
        canRunFormalTasks: boolean;
        canRunPatchGeneration: boolean;
        checks: {
          benchmark: { status: string };
          patchGeneration: { status: string };
          probe: { status: string };
          profile: { status: string };
          registry: { status: string };
        };
        status: string;
      }>(output);
      expect(readiness.status).toBe("ready");
      expect(readiness.unavailableReasonType).toBe("not-applicable");
      expect(readiness.canRunFormalTasks).toBe(true);
      expect(readiness.canRunPatchGeneration).toBe(true);
      expect(readiness.checks.profile.status).toBe("qualified");
      expect(readiness.checks.registry.status).toBe("registered");
      expect(readiness.checks.probe.status).toBe("not-run");
      expect(readiness.checks.benchmark.status).toBe("missing");
      expect(readiness.checks.patchGeneration.status).toBe("allowed");

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "readiness",
        "--worker",
        workerId,
        "--probe"
      ]);

      const probedReadiness = parseLastJson<{
        unavailableReasonType: string;
        checks: {
          probe: { status: string };
        };
        status: string;
      }>(output);
      expect(probedReadiness.status).toBe("ready");
      expect(probedReadiness.unavailableReasonType).toBe("not-applicable");
      expect(probedReadiness.checks.probe.status).toBe("passed");
    });
  });

  it("distinguishes blocked reason types for not-qualified and missing prerequisites", async () => {
    await withTempCwd(async (rootDir) => {
      const workerId = "readiness-not-qualified-worker";
      await writeCwConfig(rootDir, {
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      await writeRegistry(rootDir, [
        createRegistration({
          workerId,
          provider: "mock",
          model: "gpt-5.4-mini"
        })
      ]);
      await writeProfiles(rootDir, [
        createProfile({
          workerId,
          status: "not-qualified",
          supportedTaskTypes: createProfile().supportedTaskTypes.filter(
            (taskType) => taskType !== "patch-generation"
          ),
          routingPolicy: {
            maxTaskComplexity: "medium",
            requiresHostReview: true,
            allowCodegen: false,
            allowPatchGeneration: false,
            allowDomainTasks: false
          }
        })
      ]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "readiness",
        "--worker",
        workerId
      ]);

      const notQualified = parseLastJson<{
        unavailableReasonType: string;
        canRunFormalTasks: boolean;
        status: string;
      }>(output);
      expect(notQualified.status).toBe("unavailable");
      expect(notQualified.unavailableReasonType).toBe("worker-not-qualified");
      expect(notQualified.canRunFormalTasks).toBe(false);

      await writeProfiles(rootDir, []);
      await cli.parseAsync([
        "node",
        "cw",
        "worker",
        "readiness",
        "--worker",
        workerId
      ]);

      const blocked = parseLastJson<{
        unavailableReasonType: string;
        checks: {
          profile: { status: string };
        };
        status: string;
      }>(output);
      expect(blocked.status).toBe("unavailable");
      expect(blocked.unavailableReasonType).toBe("profile-missing");
      expect(blocked.checks.profile.status).toBe("missing");
    });
  });

  it("requires --save before updating benchmark-driven profile capabilities", async () => {
    await withTempCwd(async (rootDir) => {
      await writeRegistry(rootDir, [createRegistration()]);
      const { io } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync([
          "node",
          "cw",
          "worker",
          "benchmark",
          "--worker",
          "mock:registered-worker",
          "--suite",
          "coding-v1",
          "--update-profile-capabilities"
        ])
      ).rejects.toThrow("--update-profile-capabilities requires --save.");
    });
  });

  it("runs repository review commands", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "review",
        "repo",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"repositoryContext\"");

      await cli.parseAsync([
        "node",
        "cw",
        "review",
        "diff",
        "--worker",
        "mock:registered-worker",
        "--base",
        "HEAD",
        "--head",
        "HEAD",
        "--scope",
        "packages/core"
      ]);
      expect(output.at(-1)).toContain("\"gitDiff\"");

      await cli.parseAsync([
        "node",
        "cw",
        "review",
        "files",
        "--worker",
        "mock:registered-worker",
        "--file",
        "packages/core/src/index.ts"
      ]);
      expect(output.at(-1)).toContain("packages/core/src/index.ts");
    });
  }, 15_000);

  it("renders validation in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "validate", "--typecheck"]);

      expect(output.at(-1)).toContain("validation");
      expect(output.at(-1)).not.toContain("\"checks\"");
    });
  });

  it("runs validate and fix error commands", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "validate",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"checks\"");
      expect(output.at(-1)).toContain("\"dry-run\"");

      await cli.parseAsync([
        "node",
        "cw",
        "fix",
        "error",
        "--worker",
        "mock:registered-worker",
        "--error-log-file",
        "tmp/error.log",
        "--scope",
        "packages/core",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"rootCauseAnalysis\"");
      expect(output.at(-1)).toContain("\"repositoryContext\"");
    });
  });

  it("supports validate --all and --stop-on-failure", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeFile(
        join(rootDir, "package.json"),
        JSON.stringify(
          {
            scripts: {
              build: "node -e \"process.exit(1)\"",
              typecheck: "node -e \"process.exit(0)\"",
              lint: "node -e \"process.exit(0)\"",
              test: "node -e \"process.exit(0)\""
            }
          },
          null,
          2
        ),
        "utf8"
      );
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "validate",
        "--all",
        "--stop-on-failure",
        "--execute",
        "--summary"
      ]);

      const result = JSON.parse(output.at(-1) ?? "{}") as {
        failedChecks?: string[];
        skippedChecks?: string[];
        summary?: string;
      };
      expect(result.failedChecks).toEqual(["build"]);
      expect(result.skippedChecks).toEqual(["typecheck", "lint", "test"]);
      expect(result.summary).toContain("build");
    });
  });

  it("uses cw config for review, validate, and task entrypoints", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      await writeCwConfig(rootDir, {
        context: {
          ignoredPaths: ["tmp"]
        },
        safety: {
          dryRun: false,
          allowWrite: false,
          allowedCommands: ["git", "node", "pnpm"]
        }
      });
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "review",
        "repo",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core"
      ]);
      const reviewResult = JSON.parse(output.at(-1) ?? "{}") as {
        repositoryContext?: { selectedFiles?: Array<{ truncated?: boolean }> };
      };
      expect(
        reviewResult.repositoryContext?.selectedFiles?.every((file) => file.truncated === false)
      ).toBe(true);

      await cli.parseAsync([
        "node",
        "cw",
        "validate",
        "--typecheck"
      ]);
      const validationResult = JSON.parse(output.at(-1) ?? "{}") as {
        checks?: Array<{ status?: string }>;
      };
      expect(validationResult.checks?.[0]?.status).toBe("success");

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "start",
        "--goal",
        "Review packages/core",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--typecheck",
        "--allow-write-session"
      ]);
      const taskResult = JSON.parse(output.at(-1) ?? "{}") as {
        repositoryContext?: { selectedFiles?: Array<{ truncated?: boolean }> };
        validationReport?: { checks?: Array<{ status?: string }> };
      };
      expect(
        taskResult.repositoryContext?.selectedFiles?.every((file) => file.truncated === false)
      ).toBe(true);
      expect(taskResult.validationReport?.checks?.[0]?.status).toBe("success");
    });
  }, 15_000);

  it("runs task session lifecycle commands", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "start",
        "--goal",
        "Review packages/core",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--typecheck",
        "--allow-write-session"
      ]);
      const started = JSON.parse(output.at(-1) ?? "{}") as {
        session?: { taskId?: string };
      };
      expect(started.session?.taskId).toBeTruthy();

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "status",
        started.session?.taskId ?? ""
      ]);
      expect(output.at(-1)).toContain("\"taskId\"");

      await cli.parseAsync(["node", "cw", "task", "list"]);
      expect(output.at(-1)).toContain(started.session?.taskId ?? "");

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "resume",
        started.session?.taskId ?? "",
        "--propose-patch",
        "--inspect-patch",
        "--allow-write-session"
      ]);
      expect(output.at(-1)).toContain("\"patchProposal\"");

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "report",
        started.session?.taskId ?? ""
      ]);
      expect(output.at(-1)).toContain("# Task Session Report");
    });
  });

  it("renders task start in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "start",
        "--goal",
        "Review packages/core",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--typecheck",
        "--allow-write-session"
      ]);

      expect(output.at(-1)).toContain("task ");
      expect(output.at(-1)).toContain("outcome:");
      expect(output.at(-1)).toContain("next:");
      expect(output.at(-1)).toContain("\u001b[");
      expect(output.at(-1)).not.toContain("\"taskId\"");
    });
  });

  it("stabilizes task start --summary output without null placeholders", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "task",
        "start",
        "--goal",
        "Review packages/core",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--typecheck",
        "--allow-write-session",
        "--summary",
        "--no-artifact-refs"
      ]);

      const summary = parseLastJson<{
        accepted: boolean | string;
        artifactRefs: unknown[];
        artifactRefsStatus: string;
        finalStatus: string;
        humanSummary: string;
        outcomeSummary: string;
        validationSummary: string;
        workerReviewStatus: string;
      }>(output);

      expect(summary.finalStatus).toBeTruthy();
      expect(summary.workerReviewStatus).toBeTruthy();
      expect(summary.accepted).not.toBeNull();
      expect(summary.humanSummary).toBeTruthy();
      expect(summary.outcomeSummary).toContain("review=");
      expect(summary.validationSummary).toBeTruthy();
      expect(summary.artifactRefs).toEqual([]);
      expect(summary.artifactRefsStatus).toBe("suppressed-in-summary");
      expect(output.at(-1)).not.toContain(": null");
    });
  });

  it("renders audit list in styled human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);
      await cli.parseAsync(["node", "cw", "audit", "list", "--limit", "5"]);

      expect(output.at(-1)).toContain("audit events");
      expect(output.at(-1)).toContain("\u001b[");
    });
  });

  it("cleans up old runs and audit logs without touching registry files", async () => {
    await withTempCwd(async (rootDir) => {
      const oldTime = new Date(Date.now() - 40 * 86_400_000);
      const runsDir = getCwWorkspaceRunsDir(rootDir);
      const auditDir = getCwWorkspaceAuditDir(rootDir);
      await mkdir(join(runsDir, "task-old"), { recursive: true });
      await mkdir(auditDir, { recursive: true });
      await writeFile(
        join(runsDir, "task-old", "session.json"),
        JSON.stringify({
          taskId: "task-old",
          goal: "old",
          requireProfile: false,
          status: "completed",
          createdAt: "2026-05-01T10:00:00.000Z",
          updatedAt: "2026-05-01T10:00:00.000Z",
          steps: [],
          artifacts: {},
          warnings: [],
          errors: [],
          metadata: {}
        }),
        "utf8"
      );
      await writeFile(
        join(auditDir, "2026-05-01.jsonl"),
        "",
        "utf8"
      );
      await writeFile(
        getCwWorkspaceFilePath(rootDir, "workers.json"),
        JSON.stringify({ version: 1, workers: [] }, null, 2),
        "utf8"
      );
      await utimes(join(runsDir, "task-old"), oldTime, oldTime);
      await utimes(join(auditDir, "2026-05-01.jsonl"), oldTime, oldTime);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "cleanup",
        "runs",
        "--older-than-days",
        "30"
      ]);
      expect(output.at(-1)).toContain("\"wouldDelete\"");

      await cli.parseAsync([
        "node",
        "cw",
        "cleanup",
        "runs",
        "--older-than-days",
        "30",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"deleted\"");

      await cli.parseAsync([
        "node",
        "cw",
        "cleanup",
        "audit",
        "--older-than-days",
        "30",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"target\": \"audit\"");
    });
  });

  it("runs patch lifecycle commands", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);
      await writePatchProposalFile(rootDir);
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "propose",
        "--goal",
        "Fix typecheck",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--summary"
      ]);
      const proposedSummary = JSON.parse(output.at(-1) ?? "{}") as Record<string, unknown>;
      expect(proposedSummary.proposalId).toBeTypeOf("string");
      expect(proposedSummary).not.toHaveProperty("proposal");

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "propose",
        "--goal",
        "Fix typecheck",
        "--worker",
        "mock:registered-worker",
        "--scope",
        "packages/core",
        "--full"
      ]);
      expect(output.at(-1)).toContain("\"proposal\"");

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "inspect",
        "tmp/candidate.patch"
      ]);
      expect(output.at(-1)).toContain("\"inspection\"");

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "apply",
        "tmp/candidate.patch",
        "--dry-run"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "apply",
        "tmp/candidate.patch",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"denied\"");

      await cli.parseAsync([
        "node",
        "cw",
        "patch",
        "apply",
        "tmp/candidate.patch",
        "--allow-write",
        "--confirm-apply",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"execute\"");
    });
  }, 15_000);
});

