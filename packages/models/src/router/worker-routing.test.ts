import { describe, expect, it } from "vitest";

import type { WorkerCapabilityProfile } from "@agent-orchestrator/core";

import { assessWorkerTaskEligibility } from "./worker-routing.js";

const createProfile = (
  overrides: Partial<WorkerCapabilityProfile> = {}
): WorkerCapabilityProfile => ({
  workerId: "mock:worker-model",
  provider: "mock",
  model: "worker-model",
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
  suiteVersion: "5",
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
    codegen: 0.82,
    patchGeneration: 0.8,
    testGeneration: 0.81,
    logAnalysis: 0.78,
    jsonExtraction: 0.77,
    reviewLite: 0.8
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
});

