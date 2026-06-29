import type {
  ExecutionContext,
  WorkerCapabilityProfile,
  WorkerInterviewPersistenceAdvice
} from "@mcp-code-worker/core";
import {
  getWorkerProfile,
  resolveWorkerTarget,
  saveWorkerProfile
} from "@mcp-code-worker/models";

import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "./worker-benchmark-workflow.js";
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
  const resolvedTarget = await resolveWorkerTarget({
    context: input.context,
    workerId: input.workerId,
    provider: input.provider,
    model: input.model,
    baseURL: input.baseURL
  });
  const result = await runWorkerInterviewWorkflow({
    context: input.context,
    workerId: resolvedTarget.workerId,
    modelConfig: resolvedTarget.modelConfig
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
  const resolvedTarget = await resolveWorkerTarget({
    context: input.context,
    workerId: input.workerId,
    provider: input.provider,
    model: input.model,
    baseURL: input.baseURL
  });
  const benchmarkResult =
    input.benchmarkResult ??
    (await runWorkerBenchmarkWorkflow({
      context: input.context,
      suite,
      workerId: resolvedTarget.workerId,
      modelConfig: resolvedTarget.modelConfig
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
