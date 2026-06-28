import {
  AgentError,
  type ExecutionContext,
  type ModelConfig,
  type WorkerCapabilityProfile,
  type WorkerStatus
} from "@mcp-code-worker/core";

import { getWorkerProfile } from "./worker-profile-store.js";
import { deriveWorkerProfileId } from "./worker-profile-store.js";
import { requireConfiguredWorkerId } from "./worker-target-resolution.js";

export interface ResolveWorkerProfileInput {
  context: ExecutionContext;
  modelConfig?: ModelConfig;
  workerId?: string;
  requireProfile?: boolean;
}

export interface WorkerProfileFreshness {
  reason: string;
  shouldReinterview: boolean;
  usable: boolean;
}

export interface ResolveWorkerProfileResult {
  freshness: WorkerProfileFreshness;
  profile: WorkerCapabilityProfile | null;
  source: "persisted" | "missing" | "stale" | "incompatible" | "provider-error";
  workerId: string;
}

const knownStatuses = new Set<WorkerStatus>(["qualified", "not-qualified"]);
const providerFailureWarningPattern = /provider invocation failed/iu;
const supportedSuiteVersion = "6";

const buildFailure = (
  workerId: string,
  profile: WorkerCapabilityProfile | null,
  source: ResolveWorkerProfileResult["source"],
  reason: string
): ResolveWorkerProfileResult => ({
  workerId,
  profile,
  source,
  freshness: {
    usable: false,
    reason,
    shouldReinterview: true
  }
});

const failIfRequired = (
  result: ResolveWorkerProfileResult,
  requireProfile: boolean | undefined
): ResolveWorkerProfileResult => {
  if (requireProfile && !result.freshness.usable) {
    throw new AgentError("WORKER_PROFILE_REQUIRED", result.freshness.reason, {
      source: result.source,
      workerId: result.workerId
    });
  }

  return result;
};

const hasProviderFailureSignal = (profile: WorkerCapabilityProfile): boolean =>
  profile.interviewDiagnostics?.outcome === "provider-error" ||
  [...profile.warnings, ...profile.risks].some((message) =>
    providerFailureWarningPattern.test(message)
  );

const lacksCurrentInterviewSignals = (
  profile: WorkerCapabilityProfile
): boolean =>
  profile.suiteVersion !== supportedSuiteVersion ||
  !profile.admission ||
  !profile.portrait ||
  !profile.taskScores ||
  !profile.evidence;

export const resolveWorkerProfile = async ({
  context,
  modelConfig,
  workerId,
  requireProfile
}: ResolveWorkerProfileInput): Promise<ResolveWorkerProfileResult> => {
  const effectiveModelConfig = modelConfig ?? context.workerModel;
  const configuredWorkerId =
    requireProfile
      ? requireConfiguredWorkerId(
          context,
          workerId,
          "worker profile resolution"
        )
      : workerId ?? context.defaultWorkerId;
  const resolvedWorkerId =
    configuredWorkerId ??
    deriveWorkerProfileId(effectiveModelConfig);
  const profile = await getWorkerProfile(
    context.rootDir,
    resolvedWorkerId,
    context.cwStorageDir
  );

  if (!profile) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        null,
        "missing",
        `No persisted worker profile found for ${resolvedWorkerId}.`
      ),
      requireProfile
    );
  }

  if (profile.workerId !== resolvedWorkerId) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        profile,
        "incompatible",
        `Persisted worker profile ${profile.workerId} does not match resolved worker ${resolvedWorkerId}.`
      ),
      requireProfile
    );
  }

  if (
    profile.provider !== effectiveModelConfig.provider ||
    profile.model !== effectiveModelConfig.model
  ) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        profile,
        "incompatible",
        `Persisted worker profile ${resolvedWorkerId} does not match the current worker model configuration.`
      ),
      requireProfile
    );
  }

  if (!knownStatuses.has(profile.status)) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        profile,
        "incompatible",
        `Persisted worker profile ${resolvedWorkerId} has an unknown status.`
      ),
      requireProfile
    );
  }

  if (hasProviderFailureSignal(profile)) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        profile,
        "provider-error",
        `Persisted worker profile ${resolvedWorkerId} looks like a provider/configuration failure rather than a completed interview. Re-run 'cw worker interview --save' after checking base URL, API key, and network access.`
      ),
      requireProfile
    );
  }

  if (lacksCurrentInterviewSignals(profile)) {
    return failIfRequired(
      buildFailure(
        resolvedWorkerId,
        profile,
        "stale",
        `Persisted worker profile ${resolvedWorkerId} was created without the current repo-grounded interview signals. Re-run 'cw worker interview --save'.`
      ),
      requireProfile
    );
  }

  if (profile.expiresAt) {
    const expiresAt = Date.parse(profile.expiresAt);

    if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
      return failIfRequired(
        buildFailure(
          resolvedWorkerId,
          profile,
          "stale",
          `Persisted worker profile ${resolvedWorkerId} has expired.`
        ),
        requireProfile
      );
    }
  }

  return {
    workerId: resolvedWorkerId,
    profile,
    source: "persisted",
    freshness: {
      usable: true,
      reason: `Persisted worker profile ${resolvedWorkerId} is compatible with the current worker model.`,
      shouldReinterview: false
    }
  };
};
