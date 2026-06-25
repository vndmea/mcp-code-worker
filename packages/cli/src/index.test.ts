import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCli } from "@agent-orchestrator/cli";

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
});
