import { readFile } from "node:fs/promises";

import {
  createExecutionContextWithWorkerModel,
  loadCwConfig,
  type DoctorStatus,
  type ExecutionContext,
  WorkerBenchmarkResultSchema
} from "@mcp-code-worker/core";
import {
  getWorkerBenchmarkArtifactPath,
  qualifiesPatchGenerationCapability
} from "@mcp-code-worker/graph";
import {
  createWorkerConnectivityDoctorChecks,
  getWorkerRegistration,
  requireConfiguredWorkerId,
  resolveWorkerProfile,
  resolveWorkerTarget
} from "@mcp-code-worker/models";

export type WorkerReadinessBlockedReasonType =
  | "config-invalid"
  | "not-applicable"
  | "probe-failed"
  | "profile-incompatible"
  | "profile-missing"
  | "profile-provider-error"
  | "profile-stale"
  | "worker-not-qualified"
  | "worker-resolution-failed";

export interface WorkerReadinessCheck {
  detail: string;
  status: string;
}

export interface WorkerReadinessReport {
  blockedReasonType: WorkerReadinessBlockedReasonType;
  canRunFormalTasks: boolean;
  canRunPatchGeneration: boolean;
  checks: {
    benchmark: WorkerReadinessCheck;
    config: WorkerReadinessCheck;
    patchGeneration: WorkerReadinessCheck;
    probe: WorkerReadinessCheck;
    profile: WorkerReadinessCheck;
    registry: WorkerReadinessCheck;
  };
  nextSteps: string[];
  status: DoctorStatus;
  summary: string;
  workerId: string;
}

const defaultCheck = (
  status: string,
  detail: string
): WorkerReadinessCheck => ({
  status,
  detail
});

const readBenchmarkCheck = async (
  context: ExecutionContext,
  workerId: string
): Promise<WorkerReadinessCheck> => {
  const artifactPath = getWorkerBenchmarkArtifactPath(
    context.rootDir,
    workerId,
    "coding-v1",
    context.cwStorageDir
  );

  try {
    const parsed = WorkerBenchmarkResultSchema.parse(
      JSON.parse(await readFile(artifactPath, "utf8"))
    );

    return qualifiesPatchGenerationCapability(parsed)
      ? defaultCheck(
          "passed",
          `Persisted coding-v1 benchmark qualifies patch-generation at ${artifactPath}.`
        )
      : defaultCheck(
          "not-qualified",
          `Persisted coding-v1 benchmark exists at ${artifactPath}, but patch-generation did not qualify.`
        );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return /ENOENT/u.test(message)
      ? defaultCheck(
          "missing",
          "No persisted coding-v1 benchmark artifact was found."
        )
      : defaultCheck(
          "invalid",
          `Persisted benchmark artifact could not be read: ${message}`
        );
  }
};

const readProbeCheck = async (
  context: ExecutionContext,
  workerId: string,
  enabled: boolean
): Promise<WorkerReadinessCheck> => {
  if (!enabled) {
    return defaultCheck(
      "not-run",
      "No live probe was requested. Use --probe to confirm current connectivity."
    );
  }

  const probeContext: ExecutionContext = {
    ...createExecutionContextWithWorkerModel(context, context.workerModel),
    defaultWorkerId: workerId
  };
  const checks = await createWorkerConnectivityDoctorChecks(probeContext);
  const probe = checks[0];

  return probe?.status === "pass"
    ? defaultCheck("passed", probe.message)
    : defaultCheck("failed", probe?.message ?? "Worker connectivity probe failed.");
};

const deriveBlockedReasonType = (
  checks: WorkerReadinessReport["checks"]
): WorkerReadinessBlockedReasonType => {
  if (checks.config.status === "invalid") {
    return "config-invalid";
  }

  if (checks.registry.status === "blocked") {
    return "worker-resolution-failed";
  }

  if (checks.profile.status === "missing") {
    return "profile-missing";
  }

  if (checks.profile.status === "stale") {
    return "profile-stale";
  }

  if (checks.profile.status === "incompatible") {
    return "profile-incompatible";
  }

  if (checks.profile.status === "provider-error") {
    return "profile-provider-error";
  }

  if (checks.probe.status === "failed") {
    return "probe-failed";
  }

  if (checks.profile.status === "not-qualified") {
    return "worker-not-qualified";
  }

  return "not-applicable";
};

const buildSummary = (input: {
  blockedReasonType: WorkerReadinessBlockedReasonType;
  canRunPatchGeneration: boolean;
  status: DoctorStatus;
  workerId: string;
}): string => {
  if (input.status === "ready") {
    return input.canRunPatchGeneration
      ? `Worker ${input.workerId} is ready for formal tasks, and patch-generation is allowed.`
      : `Worker ${input.workerId} is ready for formal non-patch tasks. Patch-generation is not allowed yet.`;
  }

  switch (input.blockedReasonType) {
    case "config-invalid":
      return `Worker ${input.workerId} is blocked for formal tasks because config.json is invalid.`;
    case "worker-resolution-failed":
      return `Worker ${input.workerId} is blocked for formal tasks because worker resolution failed.`;
    case "profile-missing":
      return `Worker ${input.workerId} is blocked for formal tasks until a persisted worker profile exists.`;
    case "profile-stale":
      return `Worker ${input.workerId} is blocked for formal tasks until the persisted worker profile is refreshed.`;
    case "profile-incompatible":
      return `Worker ${input.workerId} is blocked for formal tasks because the persisted worker profile does not match the current worker configuration.`;
    case "profile-provider-error":
      return `Worker ${input.workerId} is blocked for formal tasks because the persisted worker profile reflects provider/configuration failure evidence rather than a usable onboarding result.`;
    case "probe-failed":
      return `Worker ${input.workerId} is blocked for formal tasks because the live connectivity probe failed.`;
    case "worker-not-qualified":
      return `Worker ${input.workerId} completed onboarding evidence, but it is not qualified for formal tasks.`;
    default:
      return `Worker ${input.workerId} is blocked for formal tasks until registry, profile, or connectivity prerequisites are repaired.`;
  }
};

const buildNextSteps = (input: {
  blockedReasonType: WorkerReadinessBlockedReasonType;
  checks: WorkerReadinessReport["checks"];
  status: DoctorStatus;
  workerId: string;
}): string[] => {
  const actions: string[] = [];

  if (input.checks.registry.status === "missing") {
    actions.push(
      `Register the worker first: cw worker register --worker ${input.workerId} --provider <provider> --model <model> --allow-write`
    );
  }

  if (
    ["missing", "stale", "incompatible", "provider-error"].includes(
      input.checks.profile.status
    )
  ) {
    actions.push(
      `Refresh onboarding evidence: cw worker interview --worker ${input.workerId} --save`
    );
  }

  if (input.checks.probe.status === "failed") {
    actions.push(
      `Fix connectivity, then rerun: cw worker readiness --worker ${input.workerId} --probe`
    );
  }

  if (input.blockedReasonType === "worker-not-qualified") {
    actions.push(
      `Keep this worker out of formal tasks until it qualifies. Re-run onboarding after fixing the weak capability areas: cw worker interview --worker ${input.workerId} --save`
    );
  }

  if (
    input.status === "ready" &&
    ["missing", "not-qualified"].includes(input.checks.benchmark.status)
  ) {
    actions.push(
      `If you need patch-generation, run: cw worker benchmark --worker ${input.workerId} --suite coding-v1 --save --update-profile-capabilities`
    );
  }

  if (actions.length === 0 && input.checks.probe.status === "not-run") {
    actions.push(
      `Optionally confirm live connectivity now: cw worker readiness --worker ${input.workerId} --probe`
    );
  }

  return actions;
};

export const buildWorkerReadinessReport = async (input: {
  context: ExecutionContext;
  probe?: boolean;
  workerId?: string;
}): Promise<WorkerReadinessReport> => {
  const configResult = await loadCwConfig(input.context.rootDir);
  const requestedWorkerId = requireConfiguredWorkerId(
    input.context,
    input.workerId,
    "worker readiness checks"
  );
  const fallbackWorkerId = requestedWorkerId;
  const registration = await getWorkerRegistration(
    input.context.rootDir,
    fallbackWorkerId,
    input.context.cwStorageDir
  );
  const checks: WorkerReadinessReport["checks"] = {
    config: configResult.error
      ? defaultCheck("invalid", `cw config is invalid: ${configResult.error}`)
      : configResult.exists
        ? defaultCheck("present", `cw config is present at ${configResult.path}.`)
        : defaultCheck(
            "missing",
            "No cw config.json was found. Runtime defaults are coming from env/defaults."
          ),
    registry: registration
      ? defaultCheck(
          "registered",
          `Worker ${fallbackWorkerId} is registered in the local registry.`
        )
      : defaultCheck(
          "missing",
          `Worker ${fallbackWorkerId} is not registered in the local registry.`
        ),
    profile: defaultCheck("not-produced", "Worker profile was not checked yet."),
    probe: defaultCheck("not-run", "No live probe was requested."),
    benchmark: defaultCheck(
      "missing",
      "No persisted coding-v1 benchmark artifact was found."
    ),
    patchGeneration: defaultCheck(
      "not-produced",
      "Patch-generation readiness was not established."
    )
  };

  let resolvedWorkerId = fallbackWorkerId;
  let resolvedContext = input.context;
  let resolvedWorkerModelError: string | null = null;

  try {
    const resolvedWorker = await resolveWorkerTarget({
      context: input.context,
      workerId: requestedWorkerId
    });

    resolvedWorkerId = resolvedWorker.workerId ?? requestedWorkerId;
    resolvedContext = {
      ...createExecutionContextWithWorkerModel(
        input.context,
        resolvedWorker.modelConfig
      ),
      defaultWorkerId: resolvedWorker.workerId ?? requestedWorkerId
    };
    checks.registry = resolvedWorker.source === "registry"
      ? defaultCheck(
          "registered",
          `Worker ${resolvedWorkerId} resolves through the local registry.`
        )
      : defaultCheck(
          "missing",
          `Worker ${resolvedWorkerId} resolves from config.json/runtime settings, but it is not registered in the local registry.`
        );
  } catch (error) {
    resolvedWorkerModelError = error instanceof Error ? error.message : String(error);
    checks.registry = defaultCheck("blocked", resolvedWorkerModelError);
  }

  const profileResolution = resolvedWorkerModelError
    ? null
    : await resolveWorkerProfile({
        context: resolvedContext,
        ...(requestedWorkerId || resolvedWorkerId
          ? { workerId: resolvedWorkerId }
          : {})
      });

  if (!profileResolution) {
    checks.profile = defaultCheck(
      "resolution-failed",
      "Worker profile could not be evaluated because worker model resolution failed."
    );
  } else if (!profileResolution.freshness.usable) {
    checks.profile = defaultCheck(
      profileResolution.source,
      profileResolution.freshness.reason
    );
  } else if (profileResolution.profile?.status === "qualified") {
    checks.profile = defaultCheck(
      "qualified",
      `Persisted worker profile ${resolvedWorkerId} is compatible and qualified.`
    );
  } else {
    checks.profile = defaultCheck(
      "not-qualified",
      `Persisted worker profile ${resolvedWorkerId} exists, but it is not qualified for formal tasks.`
    );
  }

  checks.probe = await readProbeCheck(
    resolvedContext,
    resolvedWorkerId,
    input.probe ?? false
  );
  checks.benchmark = await readBenchmarkCheck(resolvedContext, resolvedWorkerId);

  if (profileResolution?.profile) {
    checks.patchGeneration = profileResolution.profile.routingPolicy.allowPatchGeneration
      ? defaultCheck(
          "allowed",
          `Persisted worker profile ${resolvedWorkerId} currently allows patch-generation.`
        )
      : checks.benchmark.status === "missing"
        ? defaultCheck(
            "not-produced",
            "Patch-generation is not enabled because no qualifying persisted benchmark was found."
          )
        : defaultCheck(
            "not-allowed",
            `Persisted worker profile ${resolvedWorkerId} does not allow patch-generation.`
          );
  }

  const blockedReasonType = deriveBlockedReasonType(checks);
  const status: DoctorStatus =
    blockedReasonType === "not-applicable" ? "ready" : "blocked";
  const canRunFormalTasks = status === "ready";
  const canRunPatchGeneration =
    canRunFormalTasks && checks.patchGeneration.status === "allowed";

  return {
    workerId: resolvedWorkerId,
    status,
    blockedReasonType,
    canRunFormalTasks,
    canRunPatchGeneration,
    checks,
    summary: buildSummary({
      workerId: resolvedWorkerId,
      status,
      blockedReasonType,
      canRunPatchGeneration
    }),
    nextSteps: buildNextSteps({
      workerId: resolvedWorkerId,
      status,
      blockedReasonType,
      checks
    })
  };
};

export const formatWorkerReadinessResult = (
  result: WorkerReadinessReport
): string[] => [
  `worker readiness: ${result.workerId}`,
  `status: ${result.status}`,
  `blocked reason: ${result.blockedReasonType}`,
  `formal tasks: ${result.canRunFormalTasks ? "yes" : "no"}`,
  `patch generation: ${result.canRunPatchGeneration ? "yes" : "no"}`,
  `checks: config=${result.checks.config.status}, registry=${result.checks.registry.status}, profile=${result.checks.profile.status}, probe=${result.checks.probe.status}, benchmark=${result.checks.benchmark.status}, patch-generation=${result.checks.patchGeneration.status}`,
  `summary: ${result.summary}`,
  ...(result.nextSteps.length > 0
    ? [`next: ${result.nextSteps.slice(0, 3).join(" | ")}`]
    : [])
];
