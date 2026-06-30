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
import {
  resolveWorkflowWorkerContext,
  type LocalClientRuntimeSummary
} from "./worker-context-resolution.js";
import { runWorkerInterviewWorkflow } from "./worker-interview-workflow.js";

type SavedArtifact = Awaited<ReturnType<typeof saveWorkerBenchmarkArtifact>>;
type ResolvedWorkerProfileSource = Awaited<
  ReturnType<typeof resolveWorkerProfile>
>["source"];
type UnavailableExecutionProfileSource = Exclude<
  ResolvedWorkerProfileSource,
  "persisted"
>;

export interface SavedWorkerProfileResult {
  mode: "dry-run" | "execute" | "skipped";
  path?: string;
  reason?: string;
  recommendedActions?: string[];
}

export interface WorkerInterviewOnboardingResult
  extends Awaited<ReturnType<typeof runWorkerInterviewWorkflow>> {
  localClientRuntime?: LocalClientRuntimeSummary;
  persistence: SavedWorkerProfileResult | null;
}

export interface WorkerBenchmarkOnboardingResult {
  benchmarkResult: Awaited<ReturnType<typeof runWorkerBenchmarkWorkflow>>;
  localClientRuntime?: LocalClientRuntimeSummary;
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

const buildExecutionProfileRefreshAction = (workerId: string): string =>
  `Run 'cw worker interview --worker ${workerId} --save' to refresh the persisted profile before routing new tasks.`;

const preserveBenchmarkDerivedPatchCapability = (input: {
  existingProfile: WorkerCapabilityProfile | null;
  nextProfile: WorkerCapabilityProfile;
}): { profile: WorkerCapabilityProfile; warning?: string } => {
  const { existingProfile, nextProfile } = input;

  if (
    !existingProfile ||
    !existingProfile.routingPolicy.allowPatchGeneration ||
    !existingProfile.supportedTaskTypes.includes("patch-generation") ||
    existingProfile.unsupportedTaskTypes.includes("patch-generation") ||
    existingProfile.workerId !== nextProfile.workerId ||
    existingProfile.provider !== nextProfile.provider ||
    existingProfile.model !== nextProfile.model
  ) {
    return {
      profile: nextProfile
    };
  }

  const supportedTaskTypes = new Set(nextProfile.supportedTaskTypes);
  const unsupportedTaskTypes = new Set(nextProfile.unsupportedTaskTypes);
  const existingAllowsPatchGeneration =
    existingProfile.routingPolicy.allowPatchGeneration;

  if (existingAllowsPatchGeneration) {
    supportedTaskTypes.add("patch-generation");
    unsupportedTaskTypes.delete("patch-generation");
  } else {
    supportedTaskTypes.delete("patch-generation");
    unsupportedTaskTypes.add("patch-generation");
  }

  const patchCapabilityChanged =
    existingAllowsPatchGeneration !==
      nextProfile.routingPolicy.allowPatchGeneration ||
    supportedTaskTypes.size !== nextProfile.supportedTaskTypes.length ||
    unsupportedTaskTypes.size !== nextProfile.unsupportedTaskTypes.length;

  return {
    profile: {
      ...nextProfile,
      supportedTaskTypes: Array.from(supportedTaskTypes),
      unsupportedTaskTypes: Array.from(unsupportedTaskTypes),
      routingPolicy: {
        ...nextProfile.routingPolicy,
        allowPatchGeneration: existingAllowsPatchGeneration
      }
    },
    ...(patchCapabilityChanged
      ? {
          warning:
            `Preserved benchmark-derived patch-generation capability for ${nextProfile.workerId}. Re-run 'cw worker benchmark --worker ${nextProfile.workerId} --suite coding-v1 --save --update-profile-capabilities' after onboarding if you want to refresh patch routing.`
        }
      : {})
  };
};

const toUnavailableExecutionProfileSource = (
  source: ResolvedWorkerProfileSource
): UnavailableExecutionProfileSource =>
  source === "persisted" ? "incompatible" : source;

const buildUnavailableExecutionProfile = (input: {
  reason: string;
  source: UnavailableExecutionProfileSource;
  workerContext: ExecutionContext;
  workerId: string;
}): WorkerCapabilityProfile => {
  const refreshAction = buildExecutionProfileRefreshAction(input.workerId);

  return {
    workerId: input.workerId,
    provider: input.workerContext.workerModel.provider,
    model: input.workerContext.workerModel.model,
    status: "not-qualified",
    supportedTaskTypes: [],
    unsupportedTaskTypes: ["execution-profile-unavailable"],
    score: {
      instructionFollowing: 0,
      structuredOutput: 0,
      reasoning: 0,
      codeQuality: 0,
      domainKnowledge: 0,
      reliability: 0
    },
    risks: [input.reason],
    warnings: [`${input.reason} ${refreshAction}`],
    routingPolicy: {
      maxTaskComplexity: "low",
      requiresHostReview: true,
      allowCodegen: false,
      allowPatchGeneration: false,
      allowDomainTasks: false
    },
    evaluatedAt: new Date().toISOString(),
    admission: {
      passed: false,
      blockingReasons: [input.reason]
    },
    ...(input.source === "provider-error"
      ? {
          interviewDiagnostics: {
            outcome: "provider-error" as const,
            providerInvocationFailures: 1,
            failedTaskCount: 0,
            recommendedActions: [refreshAction]
          }
        }
      : {})
  };
};

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

  const profile = buildUnavailableExecutionProfile({
    reason: resolution.freshness.reason,
    source: toUnavailableExecutionProfileSource(resolution.source),
    workerContext: input.workerContext,
    workerId: resolution.workerId
  });

  return {
    profile,
    warnings: buildProfileWarnings(profile)
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
  const existingProfile =
    input.persistProfile && result.persistenceAdvice.canPersist
      ? await getWorkerProfile(
          input.context.rootDir,
          resolvedWorker.workerId,
          input.context.cwStorageDir
        )
      : null;
  const persistedProfile = preserveBenchmarkDerivedPatchCapability({
    existingProfile,
    nextProfile: result.profile
  });
  const persistence = await persistInterviewProfile({
    context: input.context,
    profile: persistedProfile.profile,
    persistProfile: input.persistProfile,
    persistenceAdvice: result.persistenceAdvice
  });

  return {
    ...result,
    profile: persistedProfile.profile,
    warnings: persistedProfile.warning
      ? [...result.warnings, persistedProfile.warning]
      : result.warnings,
    localClientRuntime: resolvedWorker.localClientRuntime,
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
  const resolvedWorker = input.benchmarkResult
    ? undefined
    : await resolveWorkflowWorkerContext({
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
      workerId: resolvedWorker!.workerId,
      modelConfig: resolvedWorker!.context.workerModel
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
    localClientRuntime: resolvedWorker?.localClientRuntime,
    persistence,
    profilePersistence,
    profileUpdate
  };
};
