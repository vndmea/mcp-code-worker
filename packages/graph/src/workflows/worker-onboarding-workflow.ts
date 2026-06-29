import type {
  ExecutionContext,
  WorkerCapabilityProfile,
  WorkerInterviewPersistenceAdvice
} from "@mcp-code-worker/core";
import {
  getWorkerProfile,
  resolveWorkerProfile,
  saveWorkerProfile
} from "@mcp-code-worker/models";

import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "./worker-benchmark-workflow.js";
import { resolveWorkflowWorkerContext } from "./worker-context-resolution.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";

type SavedArtifact = Awaited<ReturnType<typeof saveWorkerBenchmarkArtifact>>;

export interface SavedWorkerProfileResult {
  mode: "dry-run" | "execute" | "skipped";
  path?: string;
  reason?: string;
  recommendedActions?: string[];
}

export interface WorkerInterviewOnboardingResult
  extends Awaited<ReturnType<typeof runWorkerInterviewWorkflow>> {
  persistence: SavedWorkerProfileResult | null;
}

export interface WorkerBenchmarkOnboardingResult {
  benchmarkResult: Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;
  persistence: SavedArtifact | null;
  profilePersistence: { mode: "dry-run" | "execute"; path: string } | null;
  profileUpdate:
    | {
        capabilityUpdateApplied: boolean;
        patchGenerationQualified: boolean;
        profile: WorkerCapabilityProfile;
      }
    | null;
}

const buildProfileWarnings = (
  profile: WorkerCapabilityProfile
): string[] =>
  profile.status === "qualified"
    ? []
    : [
        `Worker ${profile.workerId} is ${profile.status}.`,
        ...profile.warnings
      ];

export const resolveWorkerCapabilityProfileForExecution = async (input: {
  providedProfile?: WorkerCapabilityProfile | null;
  requireProfile?: boolean;
  workerContext: ExecutionContext;
  workerId: string;
}): Promise<{ profile: WorkerCapabilityProfile; warnings: string[] }> => {
  if (input.providedProfile) {
    return {
      profile: input.providedProfile,
      warnings: buildProfileWarnings(input.providedProfile)
    };
  }

  const resolution = await resolveWorkerProfile({
    context: input.workerContext,
    modelConfig: input.workerContext.workerModel,
    workerId: input.workerId,
    requireProfile: input.requireProfile
  });

  if (resolution.freshness.usable && resolution.profile) {
    return {
      profile: resolution.profile,
      warnings: buildProfileWarnings(resolution.profile)
    };
  }

  const interviewResult = await runWorkerInterviewWorkflow({
    context: input.workerContext,
    workerId: resolution.workerId,
    modelConfig: input.workerContext.workerModel
  });

  const sourceWarning =
    resolution.source === "missing"
      ? `Worker profile for ${resolution.workerId} was missing; ran a fresh interview for this invocation.`
      : resolution.source === "stale"
        ? `Worker profile for ${resolution.workerId} was stale; ran a fresh interview for this invocation.`
        : resolution.source === "provider-error"
          ? `Worker profile for ${resolution.workerId} looked like a provider/configuration failure; ran a fresh interview for this invocation.`
          : `Worker profile for ${resolution.workerId} was incompatible with the current worker model; ran a fresh interview for this invocation.`;

  return {
    profile: interviewResult.profile,
    warnings: [sourceWarning, ...buildProfileWarnings(interviewResult.profile)]
  };
};

const persistInterviewProfile = async (input: {
  context: ExecutionContext;
  persistProfile: boolean;
  persistenceAdvice: WorkerInterviewPersistenceAdvice;
  profile: WorkerCapabilityProfile;
}): Promise<SavedWorkerProfileResult | null> => {
  if (!input.persistProfile) {
    return null;
  }

  if (!input.persistenceAdvice.canPersist) {
    return {
      mode: "skipped",
      reason: input.persistenceAdvice.reason,
      recommendedActions: input.persistenceAdvice.recommendedActions
    };
  }

  return saveWorkerProfile(input.context, input.profile, true);
};

export const runWorkerInterviewOnboarding = async (input: {
  baseURL?: string;
  context: ExecutionContext;
  model?: string;
  persistProfile: boolean;
  provider?: string;
  workerId: string;
}): Promise<WorkerInterviewOnboardingResult> => {
  const resolvedWorker = await resolveWorkflowWorkerContext({
    activity: "worker interview onboarding",
    context: input.context,
    baseURL: input.baseURL,
    model: input.model,
    provider: input.provider,
    workerId: input.workerId
  });
  const result = await runWorkerInterviewWorkflow({
    context: input.context,
    workerId: resolvedWorker.workerId,
    modelConfig: resolvedWorker.context.workerModel
  });
  const persistence = await persistInterviewProfile({
    context: input.context,
    profile: result.profile,
    persistProfile: input.persistProfile,
    persistenceAdvice: result.persistenceAdvice
  });

  return {
    ...result,
    persistence
  };
};

export const runWorkerBenchmarkOnboarding = async (input: {
  baseURL?: string;
  benchmarkResult?: Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;
  context: ExecutionContext;
  model?: string;
  persistArtifact: boolean;
  provider?: string;
  suite?: "coding-v1";
  updateProfileCapabilities: boolean;
  workerId: string;
}): Promise<WorkerBenchmarkOnboardingResult> => {
  const suite = input.suite ?? "coding-v1";
  const resolvedWorker = await resolveWorkflowWorkerContext({
    activity: "worker benchmark onboarding",
    context: input.context,
    baseURL: input.baseURL,
    model: input.model,
    provider: input.provider,
    workerId: input.workerId
  });
  const benchmarkResult =
    input.benchmarkResult ??
    (await runWorkerBenchmarkWorkflow({
      context: input.context,
      suite,
      workerId: resolvedWorker.workerId,
      modelConfig: resolvedWorker.context.workerModel
    }));
  const persistence = input.persistArtifact
    ? await saveWorkerBenchmarkArtifact(input.context, benchmarkResult, true)
    : null;

  const existingProfile = input.updateProfileCapabilities
    ? await getWorkerProfile(
        input.context.rootDir,
        benchmarkResult.workerId,
        input.context.cwStorageDir
      )
    : null;

  if (input.updateProfileCapabilities && !existingProfile) {
    throw new Error(
      `No persisted worker profile was found for '${benchmarkResult.workerId}'. Run 'cw worker interview --worker ${benchmarkResult.workerId} --save' first.`
    );
  }

  const profileUpdate = existingProfile
    ? applyBenchmarkCapabilityUpdate(existingProfile, benchmarkResult, {
        updateProfileCapabilities: input.updateProfileCapabilities
      })
    : null;
  const profilePersistence =
    input.persistArtifact && profileUpdate
      ? await saveWorkerProfile(input.context, profileUpdate.profile, true)
      : null;

  return {
    benchmarkResult,
    persistence,
    profilePersistence,
    profileUpdate
  };
};
