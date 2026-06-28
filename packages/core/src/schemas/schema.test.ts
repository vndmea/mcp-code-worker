import { describe, expect, it } from "vitest";

import {
  CwConfigSchema,
  AgentResultSchema,
  AgentTaskSchema,
  ModelConfigSchema,
  RuntimeDecisionSchema,
  PatchApplyResultSchema,
  PatchInspectionSchema,
  PatchProposalSchema,
  RepositoryContextPackSchema,
  TaskPlanSchema,
  TaskSessionSchema,
  ValidationReportSchema,
  WorkerBenchmarkResultSchema,
  WorkerCapabilityProfileSchema,
  WorkerRegistrationSchema,
  WorkerRegistrySchema,
  WorkflowStateSchema
} from "@mcp-code-worker/core";

describe("core schemas", () => {
  it("parses valid agent task and result data", () => {
    expect(() =>
      AgentTaskSchema.parse({
        id: "task-1",
        goal: "Plan work",
        constraints: [],
        assignedRole: "reviewer",
        priority: "high",
        metadata: {}
      })
    ).not.toThrow();

    expect(() =>
      AgentResultSchema.parse({
        taskId: "task-1",
        agentId: "agent-1",
        role: "worker",
        status: "success",
        output: {},
        confidence: 0.7,
        risks: [],
        artifacts: [],
        metadata: {}
      })
    ).not.toThrow();
  });

  it("rejects invalid orchestration decisions and model configs", () => {
    expect(() =>
      RuntimeDecisionSchema.parse({
        taskId: "task-1",
        decision: "maybe",
        reason: "invalid",
        nextActions: [],
        requiresHumanReview: false
      })
    ).toThrow();

    expect(() =>
      ModelConfigSchema.parse({
        provider: "mock",
        model: "gpt-test",
        baseURL: "not-a-url"
      })
    ).toThrow();
  });

  it("parses workflow state with nullable review fields", () => {
    expect(() =>
      WorkflowStateSchema.parse({
        task: {
          id: "task-1",
          goal: "Goal",
          constraints: [],
          assignedRole: "reviewer",
          priority: "high",
          metadata: {}
        },
        plan: null,
        workerResults: [],
        toolResults: [],
        review: null,
        finalResult: null,
        workerCapabilityProfile: null,
        warnings: [],
        errors: []
      })
    ).not.toThrow();
  });

  it("defaults plannedWorkerTasks to an empty list when older plan payloads are parsed", () => {
    const plan = TaskPlanSchema.parse({
      summary: "Plan work",
      steps: [
        {
          id: "step-1",
          title: "Inspect",
          description: "Inspect the code",
          assignedRole: "reviewer",
          validation: ["Read target files"]
        }
      ],
      workerAssignmentProposal: ["summarize-worker"],
      risks: [],
      validationStrategy: ["Run tests"]
    });

    expect(plan.plannedWorkerTasks).toEqual([]);
  });

  it("parses worker capability profiles", () => {
    expect(() =>
      WorkerCapabilityProfileSchema.parse({
        workerId: "mock:gpt-5.4-mini",
        provider: "mock",
        model: "gpt-5.4-mini",
        status: "limited",
        supportedTaskTypes: ["summarization", "json-extraction", "doc-generation"],
        unsupportedTaskTypes: ["codegen", "validation-fix"],
        score: {
          instructionFollowing: 0.9,
          structuredOutput: 0.8,
          reasoning: 0.75,
          codeQuality: 0.3,
          domainKnowledge: 0.7,
          reliability: 0.68
        },
        risks: ["codegen quality is low"],
        warnings: ["do not route codegen tasks"],
        routingPolicy: {
          maxTaskComplexity: "low",
          requiresHostReview: true,
          allowCodegen: false,
          allowPatchGeneration: false,
          allowDomainTasks: false
        },
        evaluatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        suiteName: "default-worker-onboarding-suite",
        suiteVersion: "6",
        evaluationSummary: {
          suiteName: "coding-v1",
          suiteVersion: "6",
          sampleCount: 4,
          passedCount: 3,
          failedCount: 1,
          confidenceBand: "medium",
          knownFailureModes: ["validation-honesty: optimistic apply"]
        },
        admission: {
          passed: true,
          blockingReasons: []
        },
        portrait: {
          scopeDiscipline: 0.82,
          repoGrounding: 0.76,
          answerDirectness: 0.78,
          codeUnderstanding: 0.71,
          fixPlanning: 0.69,
          implementationPlanning: 0.45,
          consistency: 0.74
        },
        taskScores: {
          summarization: 0.77,
          codeUnderstanding: 0.71,
          riskAnalysis: 0.69,
          reviewLite: 0.7,
          codegen: 0.41,
          patchGeneration: 0.38,
          testGeneration: 0.43,
          validationFix: 0.39,
          logAnalysis: 0.75,
          jsonExtraction: 0.78,
          docGeneration: 0.76
        },
        evidence: {
          failedCases: [],
          repoGroundedCases: ["structured-output", "scope-discipline", "summarization"],
          fallbackPatternCases: [],
          genericAnswerCases: []
        }
      })
    ).not.toThrow();
  });

  it("parses worker benchmark results", () => {
    expect(() =>
      WorkerBenchmarkResultSchema.parse({
        workerId: "mock:gpt-5.4-mini",
        suiteName: "coding-v1",
        suiteVersion: "1",
        fixtureResults: [
          {
            fixtureId: "type-error-fix",
            title: "Type Error Fix",
            passed: true,
            score: 0.9,
            findings: [],
            rawOutput: {
              analysis: "good"
            }
          }
        ],
        evaluationSummary: {
          suiteName: "coding-v1",
          suiteVersion: "1",
          sampleCount: 1,
          passedCount: 1,
          failedCount: 0,
          confidenceBand: "high",
          knownFailureModes: []
        }
      })
    ).not.toThrow();
  });

  it("parses worker registry records without accepting stored API keys", () => {
    const now = new Date().toISOString();
    const registration = WorkerRegistrationSchema.parse({
      workerId: "litellm:qwen3-coder",
      provider: "litellm",
      model: "qwen3-coder",
      createdAt: now,
      updatedAt: now,
      apiKey: "should-not-survive"
    });

    expect(registration.enabled).toBe(true);
    expect(registration.tags).toEqual([]);
    expect("apiKey" in registration).toBe(false);
    expect(() =>
      WorkerRegistrySchema.parse({
        version: 1,
        workers: [registration]
      })
    ).not.toThrow();
    expect(() =>
      WorkerRegistrationSchema.parse({
        workerId: "",
        provider: "litellm",
        model: "qwen3-coder",
        createdAt: now,
        updatedAt: now
      })
    ).toThrow();
  });

  it("parses repository context packs and validation reports", () => {
    expect(() =>
      RepositoryContextPackSchema.parse({
        rootDir: "/repo",
        files: [
          {
            path: "package.json",
            sizeBytes: 100,
            selected: true
          }
        ],
        selectedFiles: [
          {
            path: "package.json",
            content: "{\"name\":\"demo\"}",
            truncated: false,
            sizeBytes: 100
          }
        ],
        requestedFiles: ["package.json"],
        strictFiles: true,
        warnings: [],
        generatedAt: new Date().toISOString()
      })
    ).not.toThrow();

    expect(() =>
      ValidationReportSchema.parse({
        checks: [
          {
            name: "typecheck",
            command: "pnpm typecheck",
            status: "success"
          }
        ],
        ok: true,
        warnings: []
      })
    ).not.toThrow();

    expect(() =>
      ValidationReportSchema.parse({
        checks: [
          {
            name: "typecheck",
            command: "pnpm typecheck",
            status: "unknown"
          }
        ],
        ok: true,
        warnings: []
      })
    ).toThrow();
  });

  it("parses task sessions and config defaults", () => {
    expect(() =>
      TaskSessionSchema.parse({
        taskId: "task-1",
        goal: "Review packages/core",
        status: "created",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: [],
        artifacts: {},
        warnings: [],
        errors: [],
        metadata: {}
      })
    ).not.toThrow();

    expect(() =>
      CwConfigSchema.parse({
        version: 1,
        defaultWorkerId: "mock:default-worker",
        safety: {},
        context: {},
        sessions: {}
      })
    ).not.toThrow();

    expect(() =>
      CwConfigSchema.parse({
        version: 1,
        workerModel: {
          provider: "litellm",
          model: "qwen3-coder",
          baseURL: "not-a-url"
        }
      })
    ).toThrow();
  });

  it("parses valid patch proposals and rejects invalid ones", () => {
    const now = new Date().toISOString();

    expect(() =>
      PatchProposalSchema.parse({
        id: "patch-1",
        title: "Add validation guard",
        summary: "Introduce a safe validation guard.",
        rationale: ["Prevents unsafe patch application."],
        unifiedDiff: [
          "diff --git a/src/demo.ts b/src/demo.ts",
          "--- a/src/demo.ts",
          "+++ b/src/demo.ts",
          "@@ -1,1 +1,2 @@",
          "+// guard",
          " export const demo = true;"
        ].join("\n"),
        files: [
          {
            path: "src/demo.ts",
            changeType: "modify",
            summary: "Add a guard comment.",
            riskLevel: "low"
          }
        ],
        risks: [],
        validationPlan: ["pnpm typecheck"],
        generatedAt: now,
        source: {
          workflow: "patch-proposal-workflow"
        }
      })
    ).not.toThrow();

    expect(() =>
      PatchProposalSchema.parse({
        id: "patch-1",
        title: "Invalid patch",
        summary: "Missing diff.",
        rationale: [],
        files: [],
        risks: [],
        validationPlan: [],
        generatedAt: now,
        source: {
          workflow: "patch-proposal-workflow"
        }
      })
    ).toThrow();

    expect(() =>
      PatchInspectionSchema.parse({
        ok: false,
        files: [],
        blockedReasons: ["Patch diff was empty."],
        warnings: [],
        stats: {
          filesChanged: 0,
          additions: 0,
          deletions: 0
        }
      })
    ).not.toThrow();

    expect(() =>
      PatchApplyResultSchema.parse({
        mode: "blocked",
        applied: false,
        touchedFiles: [],
        inspection: {
          ok: false,
          files: [],
          blockedReasons: ["Patch diff was empty."],
          warnings: [],
          stats: {
            filesChanged: 0,
            additions: 0,
            deletions: 0
          }
        },
        recovery: {
          validationFailed: true,
          touchedFiles: [],
          failedChecks: ["lint"],
          preApplyDirty: false,
          dirtyFilesBeforeApply: [],
          safeToRunRollbackCommands: true,
          rollbackActions: [
            {
              command: "git",
              args: ["restore", "--worktree", "--", "src/demo.ts"]
            }
          ],
          rollbackCommands: ["git restore --worktree -- src/demo.ts"],
          manualRecoveryGuide: ["Inspect validation failures and restore touched files."]
        },
        warnings: [],
        errors: ["Patch diff was empty."]
      })
    ).not.toThrow();
  });
});
