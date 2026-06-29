import type { DoctorCheck, ExecutionContext } from "@mcp-code-worker/core";

import {
  createLocalClientDoctorChecks,
  createWorkerConnectivityDoctorChecks
} from "./worker-connectivity-doctor.js";
import { createWorkerProfileDoctorChecks } from "./worker-profile-doctor.js";

export interface WorkerDoctorCheckOptions {
  includeLocalClient?: boolean;
  includeProfile?: boolean;
  probe?: boolean;
  workerId?: string;
}

export const createWorkerDoctorChecks = async (
  context: ExecutionContext,
  options: WorkerDoctorCheckOptions = {}
): Promise<DoctorCheck[]> => {
  const checks: DoctorCheck[] = [];

  if (options.includeProfile ?? true) {
    checks.push(...(await createWorkerProfileDoctorChecks(context)));
  }

  if (options.includeLocalClient ?? true) {
    checks.push(...(await createLocalClientDoctorChecks(context)));
  }

  if (options.probe) {
    checks.push(
      ...(await createWorkerConnectivityDoctorChecks(context, {
        workerId: options.workerId
      }))
    );
  }

  return checks;
};

export const createWorkerProbeChecks = async (
  context: ExecutionContext,
  workerId?: string
): Promise<DoctorCheck[]> =>
  createWorkerConnectivityDoctorChecks(context, { workerId });
