import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aoDoctorTool,
  aoListToolsTool,
  aoListModelsTool,
  aoRunLeaderWorkerTool,
  aoToolDefinitions
} from "@agent-orchestrator/mcp-server";

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
      "ao_review_diff",
      "ao_fix_error",
      "ao_list_models",
      "ao_list_workflows",
      "ao_list_tools",
      "ao_list_audit_events",
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
    expect(tools.some((tool) => tool.name === "ao_run_leader_worker")).toBe(true);
    expect(tools.some((tool) => tool.name === "ao_doctor")).toBe(true);
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
});
