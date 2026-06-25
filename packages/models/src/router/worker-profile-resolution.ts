import {
  AgentError,
  type ExecutionContext,
  type WorkerCapabilityProfile,
  type WorkerStatus
} from "@agent-orchestrator/core";

import { getWorkerProfile } from "./worker-profile-store.js";
import { deriveWorkerProfileId } from "./worker-profile-store.js";

export interface ResolveWorkerProfileInput {
  context: ExecutionContext;
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
  source: "persisted" | "missing" | "stale" | "incompatible";
  workerId: string;
}

const knownStatuses = new Set<WorkerStatus>(["active", "limited", "blocked"]);

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

export const resolveWorkerProfile = async ({
  context,
  workerId,
  requireProfile
}: ResolveWorkerProfileInput): Promise<ResolveWorkerProfileResult> => {
  const resolvedWorkerId = workerId ?? deriveWorkerProfileId(context.workerModel);
  const profile = await getWorkerProfile(context.rootDir, resolvedWorkerId);

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
    profile.provider !== context.workerModel.provider ||
    profile.model !== context.workerModel.model
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
