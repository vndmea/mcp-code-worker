import { describe, expect, it } from "vitest";

import type { WorkerCapabilityProfile } from "@mcp-code-worker/core";

import { assessWorkerTaskEligibility } from "./worker-routing.js";

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
    "patch-generation",
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

describe("assessWorkerTaskEligibility", () => {
  it("reports an inconsistent patch-generation profile when task tags and routing policy disagree", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        routingPolicy: {
          ...createProfile().routingPolicy,
          allowPatchGeneration: false
        }
      }),
      "patch-generation"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inconsistent for patch-generation");
  });

  it("blocks patch-generation when the worker never qualified for patch capability", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        supportedTaskTypes: createProfile().supportedTaskTypes.filter(
          (taskType) => taskType !== "patch-generation"
        ),
        routingPolicy: {
          ...createProfile().routingPolicy,
          allowPatchGeneration: false
        }
      }),
      "patch-generation"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not qualified for patch-generation tasks");
  });

  it("allows patch-generation when benchmark-derived patch capability exists even if overall status remains not-qualified", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        status: "not-qualified"
      }),
      "patch-generation"
    );

    expect(result.allowed).toBe(true);
  });

  it("allows repo-grounded review when the portrait is strong enough", () => {
    const result = assessWorkerTaskEligibility(createProfile(), "review-lite");

    expect(result.allowed).toBe(true);
  });

  it("blocks review-lite when repo-grounding discipline is too weak", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        portrait: {
          ...createProfile().portrait!,
          repoGrounding: 0.61,
          scopeDiscipline: 0.69
        },
        taskScores: {
          ...createProfile().taskScores!,
          reviewLite: 0.68
        }
      }),
      "review-lite"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("repo-grounded review discipline");
  });

  it("blocks summarization when generic-answer evidence exists", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        evidence: {
          ...createProfile().evidence!,
          genericAnswerCases: ["summarization"]
        }
      }),
      "summarization"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("repository-grounded summarization discipline");
  });

  it("blocks code-understanding when code comprehension grounding is too weak", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        portrait: {
          ...createProfile().portrait!,
          codeUnderstanding: 0.64,
          repoGrounding: 0.66
        },
        taskScores: {
          ...createProfile().taskScores!,
          codeUnderstanding: 0.69
        }
      }),
      "code-understanding"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("code comprehension");
  });

  it("blocks validation-fix when implementation planning is below threshold", () => {
    const result = assessWorkerTaskEligibility(
      createProfile({
        portrait: {
          ...createProfile().portrait!,
          implementationPlanning: 0.68
        },
        taskScores: {
          ...createProfile().taskScores!,
          validationFix: 0.7
        }
      }),
      "validation-fix"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("validation-fix");
  });
});

