import { z } from "zod";

import { AvailabilityStatusSchema } from "./status-contract.schema.js";

export const WorkerAvailabilityReasonCodeSchema = z.enum([
  "config-invalid",
  "not-applicable",
  "probe-failed",
  "profile-incompatible",
  "profile-missing",
  "profile-provider-error",
  "profile-stale",
  "worker-not-qualified",
  "worker-resolution-failed"
]);

export const WorkerAvailabilityCheckStatusSchema = z.enum([
  "allowed",
  "failed",
  "invalid",
  "incompatible",
  "missing",
  "not-allowed",
  "not-produced",
  "not-qualified",
  "not-run",
  "passed",
  "present",
  "provider-error",
  "qualified",
  "registered",
  "resolution-failed",
  "stale",
  "unavailable"
]);

export const WorkerAvailabilityCheckSchema = z.object({
  detail: z.string().min(1),
  status: WorkerAvailabilityCheckStatusSchema
});

export const WorkerAvailabilityChecksSchema = z.object({
  benchmark: WorkerAvailabilityCheckSchema,
  config: WorkerAvailabilityCheckSchema,
  patchGeneration: WorkerAvailabilityCheckSchema,
  probe: WorkerAvailabilityCheckSchema,
  profile: WorkerAvailabilityCheckSchema,
  registry: WorkerAvailabilityCheckSchema
});

export const WorkerAvailabilitySnapshotSchema = z.object({
  canRunFormalTasks: z.boolean(),
  canRunPatchGeneration: z.boolean(),
  checks: WorkerAvailabilityChecksSchema,
  nextSteps: z.array(z.string()),
  status: AvailabilityStatusSchema,
  summary: z.string().min(1),
  unavailableReasonType: WorkerAvailabilityReasonCodeSchema,
  workerId: z.string().min(1)
});

export type WorkerAvailabilityReasonCode = z.infer<
  typeof WorkerAvailabilityReasonCodeSchema
>;
export type WorkerAvailabilityCheckStatus = z.infer<
  typeof WorkerAvailabilityCheckStatusSchema
>;
export type WorkerAvailabilityCheck = z.infer<
  typeof WorkerAvailabilityCheckSchema
>;
export type WorkerAvailabilityChecks = z.infer<
  typeof WorkerAvailabilityChecksSchema
>;
export type WorkerAvailabilitySnapshot = z.infer<
  typeof WorkerAvailabilitySnapshotSchema
>;
