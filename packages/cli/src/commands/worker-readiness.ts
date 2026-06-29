import type {
  ExecutionContext,
  WorkerAvailabilityReasonCode,
  WorkerAvailabilitySnapshot
} from "@mcp-code-worker/core";
import { buildWorkerAvailabilitySnapshot } from "@mcp-code-worker/models";

export type WorkerReadinessUnavailableReasonType = WorkerAvailabilityReasonCode;
export type WorkerReadinessReport = WorkerAvailabilitySnapshot;

export const buildWorkerReadinessReport = async (input: {
  context: ExecutionContext;
  probe?: boolean;
  workerId: string;
}): Promise<WorkerReadinessReport> =>
  buildWorkerAvailabilitySnapshot(input);

export const formatWorkerReadinessResult = (
  result: WorkerReadinessReport
): string[] => [
  `worker readiness: ${result.workerId}`,
  `status: ${result.status}`,
  `unavailable reason: ${result.unavailableReasonType}`,
  `formal tasks: ${result.canRunFormalTasks ? "yes" : "no"}`,
  `patch generation: ${result.canRunPatchGeneration ? "yes" : "no"}`,
  `checks: config=${result.checks.config.status}, registry=${result.checks.registry.status}, profile=${result.checks.profile.status}, probe=${result.checks.probe.status}, benchmark=${result.checks.benchmark.status}, patch-generation=${result.checks.patchGeneration.status}`,
  `summary: ${result.summary}`,
  ...(result.nextSteps.length > 0
    ? [`next: ${result.nextSteps.slice(0, 3).join(" | ")}`]
    : [])
];
