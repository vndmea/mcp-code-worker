import type { ExecutionContext, ModelConfig, WorkerCapabilityProfile } from "@mcp-code-worker/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "@mcp-code-worker/graph";
import { getWorkerProfile, saveWorkerProfile } from "@mcp-code-worker/models";

type SavedArtifact = Awaited<ReturnType<typeof saveWorkerBenchmarkArtifact>>;

export interface SavedWorkerProfileResult {
  mode: "dry-run" | "execute" | "skipped";
  path?: string;
  reason?: string;
  recommendedActions?: string[];
}

export interface WorkerBenchmarkUpdateResult {
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

export const runBenchmarkCapabilityUpdate = async (input: {
  benchmarkResult?: Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;
  context: ExecutionContext;
  modelConfig: ModelConfig;
  save: boolean;
  updateProfileCapabilities: boolean;
  workerId: string;
}): Promise<WorkerBenchmarkUpdateResult> => {
  const benchmarkResult =
    input.benchmarkResult ??
    (await runWorkerBenchmarkWorkflow({
      context: input.context,
      suite: "coding-v1",
      workerId: input.workerId,
      modelConfig: input.modelConfig
    }));
  const persistence = input.save
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
    input.save && profileUpdate
      ? await saveWorkerProfile(input.context, profileUpdate.profile, true)
      : null;

  return {
    benchmarkResult,
    persistence,
    profilePersistence,
    profileUpdate
  };
};

export const saveInterviewProfile = async (input: {
  context: ExecutionContext;
  profile: WorkerCapabilityProfile;
  save: boolean;
  persistenceAdvice: {
    canPersist: boolean;
    reason: string;
    recommendedActions: string[];
  };
}): Promise<SavedWorkerProfileResult | null> => {
  if (!input.save) {
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
