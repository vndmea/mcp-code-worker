import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  type WorkerCapabilityProfile
} from "@mcp-code-worker/core";
import {
  runHostWorkerWorkflow,
  runWorkerInterviewWorkflow
} from "@mcp-code-worker/graph";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-host-worker-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "src", "generateId.ts"),
    "export const generateId = () => 'id';\n",
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "schemaMinimum.ts"),
    "export const schemaMinimum = 1;\n",
    "utf8"
  );
  return rootDir;
};

const createProfile = (
  overrides: Partial<WorkerCapabilityProfile> = {}
): WorkerCapabilityProfile => ({
  workerId: "mock:worker-model",
  provider: "mock",
  model: "worker-model",
  status: "qualified",
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
    reasoning: 0.85,
    codeQuality: 0.82,
    domainKnowledge: 0.78,
    reliability: 0.88
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
    scopeDiscipline: 0.82,
    repoGrounding: 0.8,
    answerDirectness: 0.8,
    codeUnderstanding: 0.78,
    fixPlanning: 0.78,
    implementationPlanning: 0.8,
    consistency: 0.83
  },
  taskScores: {
    summarization: 0.79,
    codeUnderstanding: 0.78,
    riskAnalysis: 0.8,
    reviewLite: 0.8,
    codegen: 0.82,
    patchGeneration: 0.8,
    testGeneration: 0.81,
    validationFix: 0.81,
    logAnalysis: 0.78,
    jsonExtraction: 0.77,
    docGeneration: 0.79
  },
  evidence: {
    failedCases: [],
    repoGroundedCases: ["structured-output", "scope-discipline", "summarization"],
    fallbackPatternCases: [],
    genericAnswerCases: []
  },
  ...overrides
});

describe("host worker workflow", () => {
  it("runs one explicit worker task without creating an internal plan", async () => {
    const rootDir = await createWorkspace();
    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite",
      files: [
        "packages/core/src/generateId.ts",
        "packages/core/src/schemaMinimum.ts"
      ]
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.repositoryContext.selectedFiles).toHaveLength(2);
    expect((result.workerResult?.output as { answer?: string }).answer).toContain(
      "packages/core/src/generateId.ts"
    );
    expect(result.qualityGate.missingRequestedFiles).toEqual([]);
    expect(result.qualityGate.genericFallbackDetected).toBe(false);
    expect(result.qualityGate.workflowStatus).toBe("completed");
    expect(result.qualityGate.answerStatus).toBe("complete");
    expect(result.finalResult.status).toBe("success");
  });

  it("keeps strict explicit file mode narrow without byte budget failures", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, "packages", "core", "src", "wide.ts"),
      "export const wide = '".concat("x".repeat(200), "';\n"),
      "utf8"
    );

    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review explicit files only",
      taskType: "review-lite",
      files: [
        "packages/core/src/generateId.ts",
        "packages/core/src/wide.ts"
      ],
      strictFiles: true
    });

    expect(result.repositoryContext.selectedFiles.map((file) => file.path)).toEqual([
      "packages/core/src/generateId.ts",
      "packages/core/src/wide.ts"
    ]);
    expect(result.repositoryContext.selectedFiles.every((file) => file.truncated === false)).toBe(true);
  });

  it("does not mark coverage gaps from byte budgets", async () => {
    const rootDir = await createWorkspace();
    await writeFile(
      join(rootDir, "packages", "core", "src", "extra.ts"),
      "export const extra = '".concat("x".repeat(200), "';\n"),
      "utf8"
    );

    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite"
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.repositoryContext.coverageGapDetected).toBe(false);
    expect(result.qualityGate.coverageGapDetected).toBe(false);
    expect(result.qualityGate.failureStages).not.toContain("coverage-gap");
    expect(result.debug.promptTransparency.hostPrompt).toContain("Review the selected files");
    expect(result.debug.promptTransparency.workerPrompt).toContain("Return valid JSON only.");
  });

  it("reports policy-blocked workers without mixing in structured-output failure messaging", async () => {
    const rootDir = await createWorkspace();
    const blockedProfile = createProfile({
      portrait: {
        ...createProfile().portrait!,
        repoGrounding: 0.61,
        scopeDiscipline: 0.69
      },
      taskScores: {
        ...createProfile().taskScores!,
        reviewLite: 0.68
      }
    });

    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite",
      files: ["packages/core/src/generateId.ts"],
      workerCapabilityProfile: blockedProfile
    });

    expect(result.workerResult).toBeNull();
    expect(result.execution.state).toBe("blocked_by_policy");
    expect(result.qualityGate.execution.state).toBe("blocked_by_policy");
    expect(result.qualityGate.failureStages).toContain("worker-blocked-by-policy");
    expect(result.qualityGate.failureStages).not.toContain("worker-schema-validation-failure");
    expect(result.qualityGate.failureStages).not.toContain("worker-json-parse-failure");
    expect(result.qualityGate.structuredOutputStatus).toBe("not-attempted");
    expect(result.qualityGate.structuredFailureKind).toBeNull();
    expect(result.qualityGate.reasons.join("\n")).not.toContain(
      "validated structured output"
    );
  });

  it("can force a diagnostic trial run while marking the result as override-driven", async () => {
    const rootDir = await createWorkspace();
    const blockedProfile = createProfile({
      portrait: {
        ...createProfile().portrait!,
        repoGrounding: 0.61,
        scopeDiscipline: 0.69
      },
      taskScores: {
        ...createProfile().taskScores!,
        reviewLite: 0.68
      }
    });

    const result = await runHostWorkerWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false,
        rootDir
      }),
      goal: "Review the selected files for id-generation regressions",
      taskType: "review-lite",
      files: ["packages/core/src/generateId.ts"],
      forceExecution: true,
      workerCapabilityProfile: blockedProfile
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.execution.state).toBe("executed");
    expect(result.execution.overrideApplied).toBe(true);
    expect(result.qualityGate.execution.overrideApplied).toBe(true);
    expect(result.qualityGate.structuredOutputStatus).toBe("valid");
    expect(result.qualityGate.requiresHostReview).toBe(true);
    expect(result.finalResult.status).toBe("needs_review");
    expect(result.warnings.join("\n")).toContain("Policy override enabled");
  });
});

describe("worker interview workflow", () => {
  it("returns a capability profile and task results", async () => {
    const result = await runWorkerInterviewWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        dryRun: true,
        allowWrite: false
      })
    });

    expect(result.profile.workerId).toBe("default-worker");
    expect(result.taskResults.length).toBeGreaterThan(0);
  });
});
