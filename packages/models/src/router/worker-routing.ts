import type {
  WorkerCapabilityProfile,
  WorkerTaskType
} from "@agent-orchestrator/core";

export interface WorkerTaskEligibility {
  allowed: boolean;
  reason: string;
  requiresLeaderReview: boolean;
}

export const assessWorkerTaskEligibility = (
  profile: WorkerCapabilityProfile,
  taskType: WorkerTaskType
): WorkerTaskEligibility => {
  if (profile.status === "blocked") {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is blocked by onboarding evaluation.`,
      requiresLeaderReview: true
    };
  }

  if (!profile.supportedTaskTypes.includes(taskType)) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not qualified for ${taskType} tasks.`,
      requiresLeaderReview: true
    };
  }

  const repoGrounding = profile.portrait?.repoGrounding ?? 0;
  const scopeDiscipline = profile.portrait?.scopeDiscipline ?? 0;
  const answerDirectness = profile.portrait?.answerDirectness ?? 0;
  const reviewLiteScore = profile.taskScores?.reviewLite ?? 0;
  const summarizationScore = profile.taskScores?.summarization ?? 0;
  const hasGenericAnswerEvidence =
    (profile.evidence?.genericAnswerCases.length ?? 0) > 0;
  const hasFallbackPatternEvidence =
    (profile.evidence?.fallbackPatternCases.length ?? 0) > 0;

  if (
    taskType === "review-lite" &&
    (
      reviewLiteScore < 0.76 ||
      repoGrounding < 0.72 ||
      scopeDiscipline < 0.76 ||
      answerDirectness < 0.72 ||
      hasGenericAnswerEvidence ||
      hasFallbackPatternEvidence
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for review-lite tasks because repo-grounded review discipline is below the routing threshold.`,
      requiresLeaderReview: true
    };
  }

  if (
    (taskType === "summarization" ||
      taskType === "log-analysis" ||
      taskType === "json-extraction") &&
    (
      summarizationScore < 0.74 ||
      repoGrounding < 0.7 ||
      scopeDiscipline < 0.72 ||
      hasGenericAnswerEvidence ||
      hasFallbackPatternEvidence
    )
  ) {
    return {
      allowed: false,
      reason:
        `Worker ${profile.workerId} is not qualified for ${taskType} tasks because repository-grounded summarization discipline is below the routing threshold.`,
      requiresLeaderReview: true
    };
  }

  if (taskType === "codegen" && !profile.routingPolicy.allowCodegen) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not allowed to perform code generation.`,
      requiresLeaderReview: true
    };
  }

  if (
    taskType === "test-generation" &&
    !profile.supportedTaskTypes.includes("test-generation")
  ) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not allowed to generate tests.`,
      requiresLeaderReview: true
    };
  }

  if (
    taskType === "patch-generation" &&
    !profile.routingPolicy.allowPatchGeneration
  ) {
    return {
      allowed: false,
      reason: `Worker ${profile.workerId} is not allowed to generate patch proposals.`,
      requiresLeaderReview: true
    };
  }

  return {
    allowed: true,
    reason: `Worker ${profile.workerId} is qualified for ${taskType}.`,
    requiresLeaderReview: profile.routingPolicy.requiresLeaderReview
  };
};
