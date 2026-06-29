import type { DoctorCheck, ExecutionContext } from "@mcp-code-worker/core";

import { resolveWorkerProfile } from "./worker-profile-resolution.js";
import { readWorkerRegistry } from "./worker-registry-store.js";
import { readPersistedWorkerProfiles } from "./worker-profile-store.js";

export const createWorkerProfileDoctorChecks = async (
  context: ExecutionContext
): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];
  const persisted = await readPersistedWorkerProfiles(
    context.rootDir,
    context.cwStorageDir
  );
  const registry = await readWorkerRegistry(
    context.rootDir,
    context.cwStorageDir
  );

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

  if (!registry.exists) {
    checks.push({
      name: "worker-registry",
      status: "warning",
      message: "No worker registry was found.",
      metadata: {
        path: registry.path
      }
    });
  } else if (registry.error) {
    checks.push({
      name: "worker-registry",
      status: "fail",
      message: `Worker registry could not be parsed: ${registry.error}`,
      metadata: {
        path: registry.path
      }
    });

    return checks;
  } else {
    checks.push({
      name: "worker-registry",
      status: "pass",
      message: `Worker registry is readable with ${registry.workers.length} registered worker(s).`,
      metadata: {
        path: registry.path,
        workerCount: registry.workers.length
      }
    });

    registry.workers.forEach((registration) => {
      if (!registration.enabled) {
        checks.push({
          name: "registered-worker",
          status: "warning",
          message: `Registered worker ${registration.workerId} is disabled.`,
          metadata: {
            workerId: registration.workerId
          }
        });
      }
    });

    for (const registration of registry.workers.filter(
      (item) => item.enabled
    )) {
      const registeredResolution = await resolveWorkerProfile({
        context,
        workerId: registration.workerId,
        modelConfig: {
          provider: registration.provider,
          model: registration.model,
          baseURL: registration.baseURL
        }
      });

      checks.push({
        name: "registered-worker-profile",
        status: registeredResolution.freshness.usable ? "pass" : "warning",
        message: registeredResolution.freshness.reason,
        metadata: {
          source: registeredResolution.source,
          workerId: registration.workerId,
          shouldReinterview: registeredResolution.freshness.shouldReinterview
        }
      });
    }
  }
  return checks;
};
