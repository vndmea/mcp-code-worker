import type {
  WorkerCapabilityProfile,
  WorkerTaskType
} from "@mcp-code-worker/core";

export interface WorkerTaskEligibility {
  allowed: boolean;
  reason: string;
  requiresHostReview: boolean;
}

export const getPatchGenerationConsistencyIssue = (
  profile: WorkerCapabilityProfile
): string | null => {
  const hasPatchGenerationTag =
    profile.supportedTaskTypes.includes("patch-generation");
  const marksPatchGenerationUnsupported =
    profile.unsupportedTaskTypes.includes("patch-generation");

  if (
    profile.routingPolicy.allowPatchGeneration !== hasPatchGenerationTag ||
    (profile.routingPolicy.allowPatchGeneration &&
      marksPatchGenerationUnsupported)
  ) {
    return `Persisted worker profile ${profile.workerId} is inconsistent for patch-generation: routingPolicy.allowPatchGeneration, supportedTaskTypes, and unsupportedTaskTypes disagree.`;
  }

  return null;
};

export const assessWorkerTaskEligibility = (
  profile: WorkerCapabilityProfile,
  taskType: WorkerTaskType
): WorkerTaskEligibility => {
  if (taskType === "patch-generation") {
    const consistencyIssue = getPatchGenerationConsistencyIssue(profile);

    if (consistencyIssue) {
      return {
        allowed: false,
        reason: consistencyIssue,
        requiresHostReview: true
      };
    }
  }

  if (!profile.supportedTaskTypes.includes(taskType)) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not qualified for ${taskType} tasks.`,
      requiresHostReview: true
    };
  }

  const repoGrounding = profile.portrait?.repoGrounding;
  const scopeDiscipline = profile.portrait?.scopeDiscipline;
  const answerDirectness = profile.portrait?.answerDirectness;
  const codeUnderstandingScore = profile.taskScores?.codeUnderstanding;
  const riskAnalysisScore = profile.taskScores?.riskAnalysis;
  const reviewLiteScore = profile.taskScores?.reviewLite;
  const summarizationScore = profile.taskScores?.summarization;
  const validationFixScore = profile.taskScores?.validationFix;
  const docGenerationScore = profile.taskScores?.docGeneration;
  const hasGenericAnswerEvidence =
    (profile.evidence?.genericAnswerCases.length ?? 0) > 0;
  const hasFallbackPatternEvidence =
    (profile.evidence?.fallbackPatternCases.length ?? 0) > 0;

  if (
    (taskType === "review-lite" || taskType === "risk-analysis") &&
    (
      ((taskType === "review-lite" ? reviewLiteScore : riskAnalysisScore) ?? 1) < 0.76 ||
      (repoGrounding ?? 1) < 0.72 ||
      (scopeDiscipline ?? 1) < 0.76 ||
      (answerDirectness ?? 1) < 0.72 ||
      hasGenericAnswerEvidence ||
      hasFallbackPatternEvidence
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for ${taskType} tasks because repo-grounded review discipline is below the routing threshold.`,
      requiresHostReview: true
    };
  }

  if (
    (taskType === "summarization" ||
      taskType === "log-analysis" ||
      taskType === "json-extraction" ||
      taskType === "doc-generation") &&
    (
      ((taskType === "doc-generation" ? docGenerationScore : summarizationScore) ?? 1) < 0.74 ||
      (repoGrounding ?? 1) < 0.7 ||
      (scopeDiscipline ?? 1) < 0.72 ||
      hasGenericAnswerEvidence ||
      hasFallbackPatternEvidence
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for ${taskType} tasks because repository-grounded summarization discipline is below the routing threshold.`,
      requiresHostReview: true
    };
  }

  if (
    taskType === "code-understanding" &&
    (
      (codeUnderstandingScore ?? 1) < 0.72 ||
      (profile.portrait?.codeUnderstanding ?? 1) < 0.7 ||
      (repoGrounding ?? 1) < 0.68 ||
      hasGenericAnswerEvidence
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for code-understanding tasks because repository-grounded code comprehension is below the routing threshold.`,
      requiresHostReview: true
    };
  }

  if (taskType === "codegen" && !profile.routingPolicy.allowCodegen) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not allowed to perform code generation.`,
      requiresHostReview: true
    };
  }

  if (
    taskType === "validation-fix" &&
    (
      !profile.routingPolicy.allowCodegen ||
      (profile.taskScores?.codegen ?? 1) < 0.76 ||
      profile.score.codeQuality < 0.74 ||
      (profile.portrait?.implementationPlanning ?? 1) < 0.72 ||
      (validationFixScore ?? 1) < 0.76
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for validation-fix tasks because implementation quality is below the routing threshold.`,
      requiresHostReview: true
    };
  }

  if (
    taskType === "test-generation" &&
    !profile.supportedTaskTypes.includes("test-generation")
  ) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not allowed to generate tests.`,
      requiresHostReview: true
    };
  }

  if (taskType === "patch-generation") {
    if (profile.status !== "qualified") {
      return {
        allowed: false,
        reason:
          `Worker ${profile.workerId} is ${profile.status} and is not qualified for patch-generation tasks.`,
        requiresHostReview: true
      };
    }

    if (!profile.routingPolicy.allowPatchGeneration) {
      return {
        allowed: false,
        reason: `Worker ${profile.workerId} is not allowed to generate patch proposals.`,
        requiresHostReview: true
      };
    }
  }

  return {
    allowed: true,
    reason: `Worker ${profile.workerId} is qualified for ${taskType}.`,
    requiresHostReview: profile.routingPolicy.requiresHostReview
  };
};
