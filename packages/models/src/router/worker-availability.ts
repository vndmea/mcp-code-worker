import {
  createExecutionContextWithWorkerModel,
  loadCwConfig,
  qualifiesPatchGenerationCapability,
  WorkerAvailabilitySnapshotSchema,
  type DoctorReport,
  type ExecutionContext,
  type WorkerAvailabilityCheck,
  type WorkerAvailabilityCheckStatus,
  type WorkerAvailabilityChecks,
  type WorkerAvailabilityReasonCode,
  type WorkerAvailabilitySnapshot
} from "@mcp-code-worker/core";

import {
  assessWorkerTaskEligibility,
  getPatchGenerationConsistencyIssue
} from "./worker-routing.js";
import { getLatestWorkerBenchmark } from "./worker-benchmark-store.js";
import { createWorkerDoctorChecks } from "./worker-doctor.js";
import { resolveWorkerProfile } from "./worker-profile-resolution.js";
import { getWorkerRegistration } from "./worker-registry-store.js";
import { resolveWorkerTarget } from "./worker-target-resolution.js";

const defaultCheck = (
  status: WorkerAvailabilityCheckStatus,
  detail: string
): WorkerAvailabilityCheck => ({
  status,
  detail
});

const needsWorkerRegistration = (
  checks: WorkerAvailabilityChecks
): boolean =>
  checks.registry.status === "missing" ||
  (
    checks.registry.status === "unavailable" &&
    /not found in the worker registry|not registered in the local registry/u.test(
      checks.registry.detail
    )
  );

const readBenchmarkCheck = async (
  context: ExecutionContext,
  workerId: string
): Promise<WorkerAvailabilityCheck> => {
  try {
    const record = await getLatestWorkerBenchmark({
      rootDir: context.rootDir,
      workerId,
      suiteName: "coding-v1",
      cwStorageDir: context.cwStorageDir
    });

    if (!record) {
      return defaultCheck(
        "missing",
        "No persisted coding-v1 benchmark artifact was found."
      );
    }

    return qualifiesPatchGenerationCapability(record.benchmark)
      ? defaultCheck(
          "passed",
          `Persisted coding-v1 benchmark qualifies patch-generation in ${record.updatedAt}.`
        )
      : defaultCheck(
          "not-qualified",
          `Persisted coding-v1 benchmark exists from ${record.updatedAt}, but patch-generation did not qualify.`
        );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return defaultCheck(
      "invalid",
      `Persisted benchmark artifact could not be read: ${message}`
    );
  }
};

const readProbeCheck = async (
  context: ExecutionContext,
  workerId: string,
  enabled: boolean
): Promise<WorkerAvailabilityCheck> => {
  if (!enabled) {
    return defaultCheck(
      "not-run",
      "No live probe was requested. Use --probe to confirm current connectivity."
    );
  }

  const probeContext: ExecutionContext = {
    ...createExecutionContextWithWorkerModel(context, context.workerModel)
  };
  const checks = await createWorkerDoctorChecks(probeContext, {
    probe: true,
    includeLocalClient: false,
    includeProfile: false,
    workerId
  });
  const probe = checks[0];

  return probe?.status === "pass"
    ? defaultCheck("passed", probe.message)
    : defaultCheck("failed", probe?.message ?? "Worker connectivity probe failed.");
};

const deriveUnavailableReasonType = (
  checks: WorkerAvailabilityChecks
): WorkerAvailabilityReasonCode => {
  if (checks.config.status === "invalid") {
    return "config-invalid";
  }

  if (checks.registry.status === "unavailable") {
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
  canRunPatchGeneration: boolean;
  status: WorkerAvailabilitySnapshot["status"];
  unavailableReasonType: WorkerAvailabilityReasonCode;
  workerId: string;
}): string => {
  const workerLabel = `Worker ${input.workerId}`;

  if (input.status === "ready") {
    return input.canRunPatchGeneration
      ? `${workerLabel} is ready for formal tasks, and patch-generation is allowed.`
      : `${workerLabel} is ready for formal non-patch tasks. Patch-generation is not allowed yet.`;
  }

  switch (input.unavailableReasonType) {
    case "config-invalid":
      return `${workerLabel} is unavailable for formal tasks because config.json is invalid.`;
    case "worker-resolution-failed":
      return `${workerLabel} is unavailable for formal tasks because worker resolution failed.`;
    case "profile-missing":
      return `${workerLabel} is unavailable for formal tasks until a persisted worker profile exists.`;
    case "profile-stale":
      return `${workerLabel} is unavailable for formal tasks until the persisted worker profile is refreshed.`;
    case "profile-incompatible":
      return `${workerLabel} is unavailable for formal tasks because the persisted worker profile does not match the current worker configuration.`;
    case "profile-provider-error":
      return `${workerLabel} is unavailable for formal tasks because the persisted worker profile reflects provider/configuration failure evidence rather than a usable onboarding result.`;
    case "probe-failed":
      return `${workerLabel} is unavailable for formal tasks because the live connectivity probe failed.`;
    case "worker-not-qualified":
      return `${workerLabel} completed onboarding evidence, but it is not qualified for formal tasks.`;
    default:
      return `${workerLabel} is unavailable for formal tasks until registry, profile, or connectivity prerequisites are repaired.`;
  }
};

const buildNextSteps = (input: {
  checks: WorkerAvailabilityChecks;
  status: WorkerAvailabilitySnapshot["status"];
  unavailableReasonType: WorkerAvailabilityReasonCode;
  workerId: string;
}): string[] => {
  const actions: string[] = [];

  if (needsWorkerRegistration(input.checks)) {
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

  if (input.unavailableReasonType === "worker-not-qualified") {
    actions.push(
      `Keep this worker out of formal tasks until it qualifies. Re-run onboarding after fixing the weak capability areas: cw worker interview --worker ${input.workerId} --save`
    );
  }

  if (
    (
      input.status === "ready" &&
      ["invalid", "missing", "not-qualified"].includes(input.checks.patchGeneration.status)
    ) ||
    (
      input.status === "ready" &&
      ["missing", "not-qualified"].includes(input.checks.benchmark.status)
    )
  ) {
    actions.push(
      `If you need patch-generation, run: cw worker benchmark --worker ${input.workerId} --suite coding-v1 --save --update-profile-capabilities`
    );
  }

  if (
    actions.length === 0 &&
    input.checks.probe.status === "not-run"
  ) {
    actions.push(
      `Optionally confirm live connectivity now: cw worker readiness --worker ${input.workerId} --probe`
    );
  }

  return actions;
};

const buildPatchGenerationCheck = (input: {
  benchmark: WorkerAvailabilityCheck;
  profile: NonNullable<Awaited<ReturnType<typeof resolveWorkerProfile>>["profile"]>;
  workerId: string;
}): WorkerAvailabilityCheck => {
  const consistencyIssue = getPatchGenerationConsistencyIssue(input.profile);

  if (consistencyIssue) {
    return defaultCheck(
      "invalid",
      `${consistencyIssue} Re-run 'cw worker benchmark --worker ${input.workerId} --suite coding-v1 --save --update-profile-capabilities'.`
    );
  }

  const eligibility = assessWorkerTaskEligibility(
    input.profile,
    "patch-generation"
  );

  if (eligibility.allowed) {
    return defaultCheck(
      "allowed",
      `Persisted worker profile ${input.workerId} currently allows patch-generation.`
    );
  }

  if (!input.profile.routingPolicy.allowPatchGeneration) {
    return input.benchmark.status === "missing"
      ? defaultCheck(
          "not-produced",
          "Patch-generation is not enabled because no qualifying persisted benchmark was found."
        )
      : defaultCheck("not-allowed", eligibility.reason);
  }

  return defaultCheck("not-qualified", eligibility.reason);
};

export const buildWorkerAvailabilitySnapshot = async (input: {
  context: ExecutionContext;
  probe?: boolean;
  workerId: string;
}): Promise<WorkerAvailabilitySnapshot> => {
  const configResult = await loadCwConfig(input.context.rootDir);
  const requestedWorkerId = input.workerId;
  const checks: WorkerAvailabilityChecks = {
    config: configResult.error
      ? defaultCheck("invalid", `cw config is invalid: ${configResult.error}`)
      : configResult.exists
        ? defaultCheck("present", `cw config is present at ${configResult.path}.`)
        : defaultCheck(
            "missing",
            "No cw config.json was found. Runtime defaults are coming from built-in defaults."
          ),
    registry: defaultCheck(
      "missing",
      `Worker ${requestedWorkerId} has not been resolved yet.`
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

  let resolvedWorkerId = requestedWorkerId;
  let resolvedContext = input.context;
  let resolvedWorkerModelError: string | null = null;

  const registration = await getWorkerRegistration(
    input.context.rootDir,
    requestedWorkerId,
    input.context.cwStorageDir
  );
  checks.registry = registration
    ? defaultCheck(
        "registered",
        `Worker ${requestedWorkerId} is registered in the local registry.`
      )
    : defaultCheck(
        "missing",
        `Worker ${requestedWorkerId} is not registered in the local registry.`
      );

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
      )
    };
    checks.registry = defaultCheck(
      "registered",
      `Worker ${resolvedWorkerId} resolves through the local registry.`
    );
  } catch (error) {
    resolvedWorkerModelError =
      error instanceof Error ? error.message : String(error);
    checks.registry = defaultCheck("unavailable", resolvedWorkerModelError);
  }

  const profileResolution =
    resolvedWorkerModelError
      ? null
      : await resolveWorkerProfile({
          context: resolvedContext,
          workerId: resolvedWorkerId
        });

  if (!profileResolution) {
    checks.profile = defaultCheck(
      "resolution-failed",
      "Worker profile could not be evaluated because worker model resolution failed."
    );
  } else if (!profileResolution.freshness.usable) {
    checks.profile = defaultCheck(
      profileResolution.source === "persisted"
        ? "incompatible"
        : profileResolution.source,
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
    checks.patchGeneration = buildPatchGenerationCheck({
      benchmark: checks.benchmark,
      profile: profileResolution.profile,
      workerId: resolvedWorkerId
    });
  }

  const unavailableReasonType = deriveUnavailableReasonType(checks);
  const status = unavailableReasonType === "not-applicable"
    ? "ready"
    : "unavailable";
  const canRunFormalTasks = status === "ready";
  const canRunPatchGeneration =
    canRunFormalTasks && checks.patchGeneration.status === "allowed";

  return WorkerAvailabilitySnapshotSchema.parse({
    workerId: resolvedWorkerId,
    status,
    unavailableReasonType,
    canRunFormalTasks,
    canRunPatchGeneration,
    checks,
    summary: buildSummary({
      workerId: resolvedWorkerId,
      status,
      unavailableReasonType,
      canRunPatchGeneration
    }),
    nextSteps: buildNextSteps({
      workerId: resolvedWorkerId,
      status,
      unavailableReasonType,
      checks
    })
  });
};

export const applyWorkerAvailabilityToDoctorReport = (
  report: DoctorReport,
  snapshot: WorkerAvailabilitySnapshot
): DoctorReport => {
  const capabilities = report.capabilities.filter(
    (capability) => capability.name !== "worker-availability"
  );
  capabilities.push({
    name: "worker-availability",
    available: snapshot.status === "ready",
    status: snapshot.status,
    summary: snapshot.summary
  });
  const recommendedActions = Array.from(
    new Set([...snapshot.nextSteps, ...report.recommendedActions])
  );

  if (snapshot.status === "unavailable") {
    return {
      ...report,
      workerAvailability: snapshot,
      capabilities,
      recommendedActions,
      status: "unavailable",
      ok: false,
      summary: snapshot.summary
    };
  }

  return {
    ...report,
    workerAvailability: snapshot,
    capabilities,
    recommendedActions,
    summary: report.status === "ready" ? snapshot.summary : report.summary
  };
};
