import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  aoDoctorTool,
  aoGetWorkerRegistrationTool,
  aoFixErrorTool,
  aoListToolsTool,
  aoListModelsTool,
  aoReviewDiffTool,
  aoReviewFilesTool,
  aoReviewRepositoryTool,
  aoListWorkerRegistryTool,
  aoRegisterWorkerTool,
  aoRunLeaderWorkerTool,
  aoToolDefinitions,
  aoUnregisterWorkerTool,
  aoValidateRepositoryTool
} from "@agent-orchestrator/mcp-server";

const execFile = promisify(execFileCallback);

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "ao-mcp-"));

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
};

const createProfile = () => ({
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
  suiteVersion: "1"
});

describe("mcp tool registration", () => {
  it("registers the expected MCP tool names", () => {
    expect(aoToolDefinitions.map((tool) => tool.name)).toEqual([
      "ao_plan",
      "ao_run_workflow",
      "ao_run_leader_worker",
      "ao_review_repository",
      "ao_review_diff",
      "ao_review_files",
      "ao_validate_repository",
      "ao_fix_error",
      "ao_list_models",
      "ao_list_workflows",
      "ao_list_tools",
      "ao_list_audit_events",
      "ao_register_worker",
      "ao_unregister_worker",
      "ao_list_worker_registry",
      "ao_get_worker_registration",
      "ao_interview_worker",
      "ao_list_workers",
      "ao_get_worker_profile",
      "ao_doctor"
    ]);
  });

  it("lists configured models", async () => {
    const models = await aoListModelsTool.execute({});
    expect(models).toHaveLength(2);
  });

  it("lists MCP tool definitions including dedicated workflow tools", async () => {
    const tools = await aoListToolsTool.execute({});

    expect(tools.some((tool) => tool.name === "ao_list_audit_events")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_register_worker")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_run_leader_worker")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_review_repository")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_validate_repository")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_doctor")).toBe(true);
  });

  it("manages worker registry through MCP tools", async () => {
    await withTempCwd(async () => {
      const dryRun = await aoRegisterWorkerTool.execute({
        provider: "mock",
        model: "registered-worker"
      });

      expect(dryRun.mode).toBe("dry-run");

      const registered = await aoRegisterWorkerTool.execute({
        provider: "mock",
        model: "registered-worker",
        apiKeyEnvVar: "AO_TEST_WORKER_KEY",
        tags: ["coding"],
        allowWrite: true
      });
      const registrations = await aoListWorkerRegistryTool.execute({});
      const registration = await aoGetWorkerRegistrationTool.execute({
        workerId: "mock:registered-worker"
      });

      expect(registered.mode).toBe("execute");
      expect(registrations).toHaveLength(1);
      expect(registration?.apiKeyEnvVar).toBe("AO_TEST_WORKER_KEY");
      expect(JSON.stringify(registration)).not.toContain("secret");

      const removed = await aoUnregisterWorkerTool.execute({
        workerId: "mock:registered-worker",
        allowWrite: true
      });

      expect(removed.removed).toBe(true);
    });
  });

  it("executes the dedicated leader-worker MCP tool", async () => {
    const result = await aoRunLeaderWorkerTool.execute({
      goal: "Review this repository"
    });

    expect(result.state.plan).not.toBeNull();
    expect(result.finalResult?.status).toBe("needs_review");
  });

  it("executes doctor and returns a structured report", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);

      const result = await aoDoctorTool.execute({});

      expect(result.checks.some((check) => check.name === "worker-profile-store")).toBe(true);
      expect(result.checks.some((check) => check.name === "default-worker-profile")).toBe(true);
    });
  });

  it("executes repository review, validation, and fix tools", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);

      const repoReview = await aoReviewRepositoryTool.execute({
        scope: "packages/core",
        typecheck: true
      });
      const diffReview = await aoReviewDiffTool.execute({
        base: "HEAD",
        head: "HEAD",
        scope: "packages/core"
      });
      const fileReview = await aoReviewFilesTool.execute({
        files: ["packages/core/src/index.ts"]
      });
      const validation = await aoValidateRepositoryTool.execute({
        typecheck: true
      });
      const fix = await aoFixErrorTool.execute({
        errorLogFile: "tmp/error.log",
        scope: "packages/core"
      });

      expect(repoReview.repositoryContext.scope).toBe("packages/core");
      expect(diffReview.repositoryContext.gitDiff).toBeDefined();
      expect(fileReview.repositoryContext.selectedFiles[0]?.path).toBe("packages/core/src/index.ts");
      expect(validation.checks[0]?.status).toBe("dry-run");
      expect(fix.repositoryContext.scope).toBe("packages/core");
    });
  });
});
