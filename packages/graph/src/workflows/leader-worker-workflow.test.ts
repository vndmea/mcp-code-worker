import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AgentError, createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { LeaderAgent, runLeaderWorkerWorkflow } from "@agent-orchestrator/graph";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-leader-worker-"));

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

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    allowWrite: false,
    dryRun: true,
    rootDir,
    workerModel: {
      provider: "mock",
      model: "gpt-5.4-mini"
    }
  });

describe("leader-worker workflow with persisted profiles", () => {
  it("uses a persisted worker profile when one is available", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [createProfile()]);

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository"
    });

    expect(result.state.workerCapabilityProfile?.workerId).toBe("mock:gpt-5.4-mini");
    expect(result.state.warnings).not.toContain(
      expect.stringContaining("ran a fresh interview")
    );
  });

  it("runs a fresh interview when no persisted profile exists and requireProfile is false", async () => {
    const rootDir = await createRootDir();

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository"
    });

    expect(result.state.workerCapabilityProfile).not.toBeNull();
    expect(result.state.warnings.join("\n")).toContain("was missing; ran a fresh interview");
  });

  it("uses registered worker model config when interviewing missing profiles", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [createRegistration()]);

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      workerId: "mock:registered-worker"
    });

    expect(result.state.workerCapabilityProfile?.workerId).toBe(
      "mock:registered-worker"
    );
    expect(result.state.workerCapabilityProfile?.model).toBe("registered-worker");
  });

  it("fails clearly for unknown explicit workers", async () => {
    const rootDir = await createRootDir();

    await expect(
      runLeaderWorkerWorkflow({
        context: createContext(rootDir),
        goal: "Review this repository",
        workerId: "mock:unknown"
      })
    ).rejects.toThrow("not registered");
  });

  it("fails early when no persisted profile exists and requireProfile is true", async () => {
    const rootDir = await createRootDir();

    await expect(
      runLeaderWorkerWorkflow({
        context: createContext(rootDir),
        goal: "Review this repository",
        requireProfile: true
      })
    ).rejects.toBeInstanceOf(AgentError);
  });

  it("fails early for registered workers without profiles when requireProfile is true", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [createRegistration()]);

    await expect(
      runLeaderWorkerWorkflow({
        context: createContext(rootDir),
        goal: "Review this repository",
        workerId: "mock:registered-worker",
        requireProfile: true
      })
    ).rejects.toBeInstanceOf(AgentError);
  });

  it("uses compatible registered profiles and re-interviews incompatible profiles", async () => {
    const rootDir = await createRootDir();
    await writeRegistry(rootDir, [createRegistration()]);
    await writeProfiles(rootDir, [
      createProfile({
        workerId: "mock:registered-worker",
        provider: "mock",
        model: "registered-worker"
      })
    ]);

    const compatible = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      workerId: "mock:registered-worker",
      requireProfile: true
    });

    expect(compatible.state.warnings.join("\n")).not.toContain(
      "ran a fresh interview"
    );

    await writeProfiles(rootDir, [
      createProfile({
        workerId: "mock:registered-worker",
        provider: "mock",
        model: "different-worker"
      })
    ]);

    const reinterviewed = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      workerId: "mock:registered-worker"
    });

    expect(reinterviewed.state.warnings.join("\n")).toContain(
      "was incompatible"
    );
    expect(reinterviewed.state.workerCapabilityProfile?.model).toBe(
      "registered-worker"
    );
  });

  it("prevents blocked persisted workers from receiving production tasks", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(
      rootDir,
      [
        createProfile({
          status: "blocked",
          supportedTaskTypes: [],
          unsupportedTaskTypes: [
            "summarization",
            "log-analysis",
            "json-extraction",
            "review-lite",
            "codegen",
            "test-generation"
          ],
          warnings: ["Do not route production tasks to this worker."],
          routingPolicy: {
            maxTaskComplexity: "low",
            requiresLeaderReview: true,
            allowCodegen: false,
            allowPatchGeneration: false,
            allowDomainTasks: false
          }
        })
      ]
    );

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      requireProfile: true
    });

    expect(result.state.workerResults).toHaveLength(0);
    expect(result.state.warnings.join("\n")).toContain("blocked");
  });

  it("restricts code generation for limited persisted workers", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(
      rootDir,
      [
        createProfile({
          status: "limited",
          supportedTaskTypes: ["summarization", "log-analysis", "json-extraction", "review-lite"],
          unsupportedTaskTypes: ["codegen", "test-generation"],
          warnings: ["Code generation is disabled for this worker."],
          routingPolicy: {
            maxTaskComplexity: "low",
            requiresLeaderReview: true,
            allowCodegen: false,
            allowPatchGeneration: false,
            allowDomainTasks: false
          }
        })
      ]
    );

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Generate implementation drafts",
      requireProfile: true
    });

    expect(
      result.state.workerResults.some((workerResult) => workerResult.agentId === "worker.codegen")
    ).toBe(false);
    expect(result.state.warnings.join("\n")).toContain("not qualified for codegen");
    expect(
      result.state.workerResults.some((workerResult) => workerResult.agentId === "worker.summarize")
    ).toBe(true);
  });

  it("skips worker dispatch when the plan has no plannedWorkerTasks", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [createProfile()]);
    const planSpy = vi
      .spyOn(LeaderAgent.prototype, "createPlan")
      .mockResolvedValue({
        summary: "No worker tasks",
        steps: [],
        plannedWorkerTasks: [],
        workerAssignmentProposal: [],
        risks: [],
        validationStrategy: []
      });

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      requireProfile: true
    });

    expect(result.state.workerResults).toHaveLength(0);
    expect(result.state.warnings.join("\n")).toContain("plannedWorkerTasks");
    expect(
      result.state.toolResults.find((tool) => tool.toolName === "validate-worker-results")
    ).toMatchObject({
      status: "dry-run",
      metadata: {
        reason: "no-planned-worker-tasks"
      }
    });
    planSpy.mockRestore();
  });

  it("warns when the plan includes a known but unregistered worker task type", async () => {
    const rootDir = await createRootDir();
    await writeProfiles(rootDir, [createProfile()]);
    const planSpy = vi
      .spyOn(LeaderAgent.prototype, "createPlan")
      .mockResolvedValue({
        summary: "Use log analysis",
        steps: [],
        plannedWorkerTasks: [
          {
            id: "log-analysis",
            taskType: "log-analysis",
            goal: "Analyze the failure log",
            riskLevel: "low",
            expectedArtifactType: "summary"
          }
        ],
        workerAssignmentProposal: [],
        risks: [],
        validationStrategy: []
      });

    const result = await runLeaderWorkerWorkflow({
      context: createContext(rootDir),
      goal: "Review this repository",
      requireProfile: true
    });

    expect(result.state.workerResults).toHaveLength(0);
    expect(result.state.warnings.join("\n")).toContain(
      "No registered worker implementation is available for planned task type log-analysis."
    );
    expect(
      result.state.toolResults.find((tool) => tool.toolName === "validate-worker-results")
    ).toMatchObject({
      status: "dry-run",
      metadata: {
        reason: "worker-tasks-skipped"
      }
    });
    planSpy.mockRestore();
  });
});
