import {
  runDoctor,
  type DoctorCheck,
  type DoctorReport,
  type ExecutionContext
} from "@mcp-code-worker/core";

import {
  applyWorkerAvailabilityToDoctorReport,
  buildWorkerAvailabilitySnapshot
} from "./worker-availability.js";
import { createWorkerDoctorChecks } from "./worker-doctor.js";

export const buildDoctorReport = async (input: {
  additionalChecks?: DoctorCheck[];
  context: ExecutionContext;
  probe?: boolean;
  transformReport?: (report: DoctorReport) => Promise<void> | void;
}): Promise<DoctorReport> => {
  const report = await runDoctor(input.context, {
    additionalChecks: [
      ...(await createWorkerDoctorChecks(input.context, {
        probe: input.probe
      })),
      ...(input.additionalChecks ?? [])
    ]
  });
  const workerAvailability = await buildWorkerAvailabilitySnapshot({
    context: input.context,
    probe: input.probe
  });
  applyWorkerAvailabilityToDoctorReport(report, workerAvailability);

  await input.transformReport?.(report);

  return report;
};
