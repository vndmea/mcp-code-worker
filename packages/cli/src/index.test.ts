import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildCli } from "@agent-orchestrator/cli";
import { PatchProposalSchema } from "@agent-orchestrator/core";

const execFile = promisify(execFileCallback);

const createIo = () => {
  const output: string[] = [];
  const errors: string[] = [];

  return {
    output,
    errors,
    io: {
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

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const aoDir = join(rootDir, ".ao");
  await mkdir(aoDir, { recursive: true });
  await writeFile(
    join(aoDir, "worker-profiles.json"),
    JSON.stringify(profiles, null, 2),
    "utf8"
  );
};

const writeRegistry = async (rootDir: string, workers: unknown[]): Promise<void> => {
  const aoDir = join(rootDir, ".ao");
  await mkdir(aoDir, { recursive: true });
  await writeFile(
    join(aoDir, "workers.json"),
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
  await mkdir(join(rootDir, ".ao"), { recursive: true });
  await writeFile(
    join(rootDir, ".ao", "config.json"),
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
    "log-analysis",
    "json-extraction",
    "review-lite",
    "codegen",
    "test-generation"
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
    requiresLeaderReview: false,
    allowCodegen: true,
    allowPatchGeneration: true,
    allowDomainTasks: true
  },
  evaluatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  suiteName: "default-worker-onboarding-suite",
  suiteVersion: "1",
  ...overrides
});

describe("cli parsing", () => {
  it("runs models list", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "models", "list"]);

    expect(output.join("\n")).toContain("\"role\": \"leader\"");
    expect(output.join("\n")).toContain("\"role\": \"worker\"");
  });

  it("lists mcp tools", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "mcp", "list-tools"]);

    expect(output.join("\n")).toContain("ao_plan");
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

  it("runs worker list", async () => {
    const { io, output } = createIo();
    const cli = buildCli(io);

    await cli.parseAsync(["node", "ao", "worker", "list"]);

    expect(output.join("\n")).toContain("[");
  });

  it("fails unknown explicit workers in the leader-worker workflow", async () => {
    await withTempCwd(async () => {
      const { io } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync([
          "node",
          "ao",
          "run",
          "leader-worker-workflow",
          "--goal",
          "Review this repository",
          "--worker",
          "mock:custom-worker"
        ])
      ).rejects.toThrow("not registered");
    });
  });

  it("uses registered workers in the leader-worker workflow", async () => {
    await withTempCwd(async (rootDir) => {
      await writeRegistry(rootDir, [createRegistration()]);
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "run",
        "leader-worker-workflow",
        "--goal",
        "Review this repository",
        "--worker",
        "mock:registered-worker"
      ]);

      expect(output.join("\n")).toContain("\"workerId\": \"mock:registered-worker\"");
      expect(output.join("\n")).toContain("\"model\": \"registered-worker\"");
    });
  });

  it("fails when require-profile is used without a persisted profile", async () => {
    await withTempCwd(async () => {
      const { io } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync([
          "node",
          "ao",
          "run",
          "leader-worker-workflow",
          "--goal",
          "Review this repository",
          "--require-profile"
        ])
      ).rejects.toThrow("No persisted worker profile found");
    });
  });

  it("rejects worker profile options on unsupported workflows", async () => {
    await withTempCwd(async () => {
      const { io } = createIo();
      const cli = buildCli(io);

      await expect(
        cli.parseAsync([
          "node",
          "ao",
          "run",
          "planning-workflow",
          "--goal",
          "Plan this task",
          "--worker",
          "mock:custom-worker"
        ])
      ).rejects.toThrow("--worker is only supported for leader-worker-workflow.");
    });
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
            requiresLeaderReview: false,
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
        await readFile(join(rootDir, ".ao", "worker-profiles.json"), "utf8")
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
        await readFile(join(rootDir, ".ao", "worker-profiles.json"), "utf8")
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
          maxFileBytes: 1,
          maxTotalBytes: 64,
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
        reviewResult.repositoryContext?.selectedFiles?.some((file) => file.truncated === true)
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
        taskResult.repositoryContext?.selectedFiles?.some((file) => file.truncated === true)
      ).toBe(true);
      expect(taskResult.validationReport?.checks?.[0]?.status).toBe("success");
    });
  }, 15_000);

  it("initializes local ao scaffolding", async () => {
    await withTempCwd(async () => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "init",
        "--leader-provider",
        "litellm",
        "--leader-model",
        "qwen3-coder",
        "--leader-api-key-env-var",
        "LITELLM_API_KEY"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"dry-run\"");
      expect(output.at(-1)).toContain(".ao/config.json");

      await cli.parseAsync([
        "node",
        "ao",
        "init",
        "--leader-provider",
        "litellm",
        "--leader-model",
        "qwen3-coder",
        "--leader-api-key-env-var",
        "LITELLM_API_KEY",
        "--allow-write"
      ]);
      expect(output.at(-1)).toContain("\"mode\": \"execute\"");
      expect(output.at(-1)).toContain(".ao/config.json");
    });
  });

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

  it("cleans up old runs and audit logs without touching registry files", async () => {
    await withTempCwd(async (rootDir) => {
      const oldTime = new Date(Date.now() - 40 * 86_400_000);
      await mkdir(join(rootDir, ".ao", "runs", "task-old"), { recursive: true });
      await mkdir(join(rootDir, ".ao", "audit"), { recursive: true });
      await writeFile(
        join(rootDir, ".ao", "runs", "task-old", "session.json"),
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
        join(rootDir, ".ao", "audit", "2026-05-01.jsonl"),
        "",
        "utf8"
      );
      await writeFile(
        join(rootDir, ".ao", "workers.json"),
        JSON.stringify({ version: 1, workers: [] }, null, 2),
        "utf8"
      );
      await utimes(join(rootDir, ".ao", "runs", "task-old"), oldTime, oldTime);
      await utimes(join(rootDir, ".ao", "audit", "2026-05-01.jsonl"), oldTime, oldTime);
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
