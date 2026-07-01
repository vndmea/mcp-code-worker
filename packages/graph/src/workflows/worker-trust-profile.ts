import type {
  WorkerCapabilityProfile,
  WorkerTaskType,
  WorkerTrustProfile
} from "@mcp-code-worker/core";

export const buildMissingWorkerTrustProfile = (
  workerId: string,
  warnings: string[] = []
): WorkerTrustProfile => ({
  workerId,
  trustLevel: "unknown",
  onboardingStatus: "missing",
  interviewStatus: "missing",
  benchmarkStatus: "missing",
  recommendedMode: "dry-run",
  warnings
});

export const buildWorkerTrustProfile = (input: {
  eligibilityAllowed: boolean;
  forceExecution: boolean;
  profile: WorkerCapabilityProfile;
  profileWarnings: string[];
  taskType: WorkerTaskType;
}): WorkerTrustProfile => {
  const benchmarkStatus =
    input.profile.taskScores &&
    input.profile.supportedTaskTypes.includes(input.taskType)
      ? "passed"
      : "not-run";
  const interviewStatus =
    input.profile.status === "qualified" ? "passed" : "failed";
  const onboardingStatus =
    input.profile.admission?.passed === false
      ? "failed"
      : input.profile.admission?.passed === true
        ? "passed"
        : "not-run";
  const trustLevel: WorkerTrustProfile["trustLevel"] =
    input.profile.status !== "qualified"
      ? "unknown"
      : benchmarkStatus === "passed"
        ? "benchmarked"
        : "interviewed";
  const recommendedMode: WorkerTrustProfile["recommendedMode"] =
    !input.eligibilityAllowed && !input.forceExecution
      ? "blocked"
      : input.forceExecution || input.profile.routingPolicy.requiresHostReview
        ? "host-review"
        : "dry-run";

  return {
    workerId: input.profile.workerId,
    trustLevel,
    onboardingStatus,
    interviewStatus,
    benchmarkStatus,
    recommendedMode,
    warnings: input.profileWarnings
  };
};
