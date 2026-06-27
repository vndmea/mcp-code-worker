import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildCli } from "@agent-orchestrator/cli";
import {
  getAoConfigPath,
  getAoWorkspaceAuditDir,
  getAoWorkspaceFilePath,
  getAoWorkspaceRunsDir,
  PatchProposalSchema
} from "@agent-orchestrator/core";

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

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "ao-cli-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

const parseLastJson = <T>(output: string[]): T =>
  JSON.parse(output.at(-1) ?? "{}") as T;

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const profilePath = getAoWorkspaceFilePath(rootDir, "worker-profiles.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify(profiles, null, 2),
    "utf8"
  );
};

const writeRegistry = async (rootDir: string, workers: unknown[]): Promise<void> => {
  const registryPath = getAoWorkspaceFilePath(rootDir, "workers.json");
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

const writeAoConfig = async (rootDir: string, config: Record<string, unknown>): Promise<void> => {
  const configPath = getAoConfigPath(rootDir);
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

const initGitRepo = async (rootDir: string): Promise<void> => {
  await execFile("git", ["init"], { cwd: rootDir });
  await execFile("git", ["config", "user.email", "ao@example.com"], { cwd: rootDir });
  await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: rootDir });
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
  status: "active",
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

    await cli.parseAsync(["node", "ao", "models", "list"]);

    expect(output.join("\n")).toContain("\"role\": \"worker\"");
  });

  it("lists mcp tools", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "mcp", "list-tools"]);

    expect(output.join("\n")).toContain("ao_run_host_worker");
    expect(output.join("\n")).toContain("ao_list_tools");
  });

  it("prints a generic mcp config snippet", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "mcp", "config"]);

    expect(output.join("\n")).toContain("\"agent-orchestrator\"");
    expect(output.join("\n")).toContain("\"mcp\"");
    expect(output.join("\n")).toContain("\"serve\"");
  });

  it("prints an mcp config snippet with an explicit root override", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync([
      "node",
      "ao",
      "mcp",
      "config",
      "--root",
      "${workspaceFolder}"
    ]);

    expect(output.join("\n")).toContain("\"--root\"");
    expect(output.join("\n")).toContain("${workspaceFolder}");
  });

  it("prints an mcp config snippet with local client env overrides", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync([
      "node",
      "ao",
      "mcp",
      "config",
      "--root",
      "${workspaceFolder}",
      "--worker-client-command",
      "custom-client",
      "--env",
      "AO_HOME_DIR=C:\\Users\\me\\.ao"
    ]);

    expect(output.join("\n")).toContain("\"env\"");
    expect(output.join("\n")).toContain(
      "\"AO_WORKER_CLIENT_COMMAND\": \"custom-client\""
    );
    expect(output.join("\n")).toContain("\"AO_HOME_DIR\": \"C:\\\\Users\\\\me\\\\.ao\"");
  });

  it("runs worker list", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "worker", "list"]);

    expect(output.join("\n")).toContain("[");
  });

  it("runs doctor and returns structured JSON", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "ao", "doctor"]);

      expect(output.join("\n")).toContain("\"checks\"");
      expect(output.join("\n")).toContain("\"worker-profile-store\"");
    });
  });

  it("renders doctor in compact human mode", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync(["node", "ao", "doctor"]);

      expect(output.at(-1)).toContain("ao doctor:");
      expect(output.at(-1)).not.toContain("\"checks\"");
    });
  });

  it("runs setup and returns the minimal success path", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "ao", "setup"]);

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

  it("can apply setup, register a worker, and persist an interviewed profile", async () => {
    await withTempCwd(async (rootDir) => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "setup",
        "--worker-provider",
        "mock",
        "--worker-model",
        "setup-worker",
        "--register-worker",
        "--interview-worker",
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
          (step) => step.id === "interview-worker" && step.status === "completed"
        )
      ).toBe(true);

      const savedConfig = JSON.parse(
        await readFile(getAoConfigPath(rootDir), "utf8")
      ) as {
        workerModel?: { model?: string };
        validation?: {
          scripts?: {
            lint?: string[];
            typecheck?: string[];
          };
        };
      };
      const savedRegistry = JSON.parse(
        await readFile(getAoWorkspaceFilePath(rootDir, "workers.json"), "utf8")
      ) as {
        workers: Array<{ workerId: string }>;
      };
      const savedProfiles = JSON.parse(
        await readFile(getAoWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{ workerId: string }>;

      expect(savedConfig.workerModel?.model).toBe("setup-worker");
      expect(savedConfig.validation?.scripts?.typecheck).toContain("check-types");
      expect(savedConfig.validation?.scripts?.lint).toContain("lint:ci");
      expect(savedRegistry.workers.some((worker) => worker.workerId === "mock:setup-worker")).toBe(
        true
      );
      expect(savedProfiles.some((profile) => profile.workerId === "mock:setup-worker")).toBe(
        true
      );
    });
  });

  it("manages worker registry entries", async () => {
    await withTempCwd(async () => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "register",
        "--provider",
        "mock",
        "--model",
        "registered-worker"
      ]);
      expect(output.join("\n")).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "register",
        "--provider",
        "mock",
        "--model",
        "registered-worker",
        "--tag",
        "coding",
        "--allow-write"
      ]);
      await cli.parseAsync(["node", "ao", "worker", "registry", "list"]);
      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "registry",
        "get",
        "mock:registered-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:registered-worker\"");
      expect(output.join("\n")).toContain("\"tags\"");

      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "unregister",
        "mock:registered-worker"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "ao",
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
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "interview",
        "--worker",
        "mock:registered-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:registered-worker\"");
      expect(output.join("\n")).toContain("\"model\": \"registered-worker\"");

      await cli.parseAsync([
        "node",
        "ao",
        "worker",
        "interview",
        "--provider",
        "mock",
        "--model",
        "manual-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:manual-worker\"");

      await expect(
        cli.parseAsync([
          "node",
          "ao",
          "worker",
          "interview",
          "--worker",
          "mock:unknown"
        ])
      ).rejects.toThrow("not registered");
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
        "ao",
        "worker",
        "benchmark",
        "--worker",
        "mock:registered-worker",
        "--suite",
        "coding-v1",
        "--save"
      ]);

      let savedProfiles = JSON.parse(
        await readFile(getAoWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{
        routingPolicy?: { allowPatchGeneration?: boolean };
        supportedTaskTypes?: string[];
      }>;
      expect(output.at(-1)).toContain("\"capabilityUpdateApplied\": false");
      expect(savedProfiles[0]?.supportedTaskTypes).not.toContain("patch-generation");
      expect(savedProfiles[0]?.routingPolicy?.allowPatchGeneration).toBe(false);

      await cli.parseAsync([
        "node",
        "ao",
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
        await readFile(getAoWorkspaceFilePath(rootDir, "worker-profiles.json"), "utf8")
      ) as Array<{
        routingPolicy?: { allowPatchGeneration?: boolean };
        supportedTaskTypes?: string[];
      }>;
      expect(output.at(-1)).toContain("\"capabilityUpdateApplied\": true");
      expect(savedProfiles[0]?.supportedTaskTypes).toContain("patch-generation");
      expect(savedProfiles[0]?.routingPolicy?.allowPatchGeneration).toBe(true);
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
          "ao",
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
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "review",
        "repo",
        "--scope",
        "packages/core",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"repositoryContext\"");

      await cli.parseAsync([
        "node",
        "ao",
        "review",
        "diff",
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
        "ao",
        "review",
        "files",
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

      await cli.parseAsync(["node", "ao", "validate", "--typecheck"]);

      expect(output.at(-1)).toContain("validation");
      expect(output.at(-1)).not.toContain("\"checks\"");
    });
  });

  it("runs validate and fix error commands", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "validate",
        "--typecheck"
      ]);
      expect(output.at(-1)).toContain("\"checks\"");
      expect(output.at(-1)).toContain("\"dry-run\"");

      await cli.parseAsync([
        "node",
        "ao",
        "fix",
        "error",
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

  it("uses ao config for review, validate, and task entrypoints", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeAoConfig(rootDir, {
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
        "ao",
        "review",
        "repo",
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
        "ao",
        "validate",
        "--typecheck"
      ]);
      const validationResult = JSON.parse(output.at(-1) ?? "{}") as {
        checks?: Array<{ status?: string }>;
      };
      expect(validationResult.checks?.[0]?.status).toBe("success");

      await cli.parseAsync([
        "node",
        "ao",
        "task",
        "start",
        "--goal",
        "Review packages/core",
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
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "task",
        "start",
        "--goal",
        "Review packages/core",
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
        "ao",
        "task",
        "status",
        started.session?.taskId ?? ""
      ]);
      expect(output.at(-1)).toContain("\"taskId\"");

      await cli.parseAsync(["node", "ao", "task", "list"]);
      expect(output.at(-1)).toContain(started.session?.taskId ?? "");

      await cli.parseAsync([
        "node",
        "ao",
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
        "ao",
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
      const { io, output } = createIo("human");
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "task",
        "start",
        "--goal",
        "Review packages/core",
        "--scope",
        "packages/core",
        "--typecheck",
        "--allow-write-session"
      ]);

      expect(output.at(-1)).toContain("task ");
      expect(output.at(-1)).toContain("next:");
      expect(output.at(-1)).not.toContain("\"taskId\"");
    });
  });

  it("cleans up old runs and audit logs without touching registry files", async () => {
    await withTempCwd(async (rootDir) => {
      const oldTime = new Date(Date.now() - 40 * 86_400_000);
      const runsDir = getAoWorkspaceRunsDir(rootDir);
      const auditDir = getAoWorkspaceAuditDir(rootDir);
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
        getAoWorkspaceFilePath(rootDir, "workers.json"),
        JSON.stringify({ version: 1, workers: [] }, null, 2),
        "utf8"
      );
      await utimes(join(runsDir, "task-old"), oldTime, oldTime);
      await utimes(join(auditDir, "2026-05-01.jsonl"), oldTime, oldTime);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "cleanup",
        "runs",
        "--older-than-days",
        "30"
      ]);
      expect(output.at(-1)).toContain("\"wouldDelete\"");

      await cli.parseAsync([
        "node",
        "ao",
        "cleanup",
        "runs",
        "--older-than-days",
        "30",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"deleted\"");

      await cli.parseAsync([
        "node",
        "ao",
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
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "patch",
        "propose",
        "--goal",
        "Fix typecheck",
        "--scope",
        "packages/core",
        "--summary"
      ]);
      const proposedSummary = JSON.parse(output.at(-1) ?? "{}") as Record<string, unknown>;
      expect(proposedSummary.proposalId).toBeTypeOf("string");
      expect(proposedSummary).not.toHaveProperty("proposal");

      await cli.parseAsync([
        "node",
        "ao",
        "patch",
        "propose",
        "--goal",
        "Fix typecheck",
        "--scope",
        "packages/core",
        "--full"
      ]);
      expect(output.at(-1)).toContain("\"proposal\"");

      await cli.parseAsync([
        "node",
        "ao",
        "patch",
        "inspect",
        "tmp/candidate.patch"
      ]);
      expect(output.at(-1)).toContain("\"inspection\"");

      await cli.parseAsync([
        "node",
        "ao",
        "patch",
        "apply",
        "tmp/candidate.patch",
        "--dry-run"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"dry-run\"");

      await cli.parseAsync([
        "node",
        "ao",
        "patch",
        "apply",
        "tmp/candidate.patch",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"blocked\"");

      await cli.parseAsync([
        "node",
        "ao",
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

