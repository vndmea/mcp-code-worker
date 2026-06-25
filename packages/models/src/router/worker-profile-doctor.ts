import type { DoctorCheck, ExecutionContext } from "@agent-orchestrator/core";

import { resolveWorkerProfile } from "./worker-profile-resolution.js";
import { readPersistedWorkerProfiles } from "./worker-profile-store.js";

export const createWorkerProfileDoctorChecks = async (
  context: ExecutionContext
): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];
  const persisted = await readPersistedWorkerProfiles(context.rootDir);

  if (!persisted.exists) {
    checks.push({
      name: "worker-profile-store",
      status: "warning",
      message: "No persisted worker profile store was found.",
      metadata: {
        path: persisted.path
      }
    });
  } else if (persisted.error) {
    checks.push({
      name: "worker-profile-store",
      status: "fail",
      message: `Persisted worker profile store could not be parsed: ${persisted.error}`,
      metadata: {
        path: persisted.path
      }
    });

    return checks;
  } else {
    checks.push({
      name: "worker-profile-store",
      status: "pass",
      message: `Persisted worker profile store is readable with ${persisted.profiles.length} profile(s).`,
      metadata: {
        path: persisted.path,
        profileCount: persisted.profiles.length
      }
    });
  }

  const resolution = await resolveWorkerProfile({
    context
  });

  checks.push({
    name: "default-worker-profile",
    status: resolution.freshness.usable ? "pass" : "warning",
    message: resolution.freshness.reason,
    metadata: {
      source: resolution.source,
      workerId: resolution.workerId
    }
  });

  return checks;
};
