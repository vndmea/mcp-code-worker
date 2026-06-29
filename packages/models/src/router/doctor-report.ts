import {
  type DoctorCapability,
  runDoctor,
  type DoctorCheck,
  type DoctorReport,
  type DoctorStatus,
  type ExecutionContext
} from "@mcp-code-worker/core";

import {
  applyWorkerAvailabilityToDoctorReport,
  buildWorkerAvailabilitySnapshot
} from "./worker-availability.js";
import { createWorkerDoctorChecks } from "./worker-doctor.js";

export const HOST_MCP_CHECK_NAMES = [
  "host-config-present",
  "host-config-valid",
  "mcp-server-launchable",
  "mcp-connection",
  "mcp-tool-catalog-match"
] as const;

const HOST_MCP_CHECK_NAME_SET = new Set<string>(HOST_MCP_CHECK_NAMES);

const buildHostMcpCapability = (
  host: string,
  checks: DoctorCheck[]
): DoctorCapability => {
  const relevantChecks = checks.filter((check) => HOST_MCP_CHECK_NAME_SET.has(check.name));
  const status: DoctorStatus = relevantChecks.every((check) => check.status === "pass")
    ? "ready"
    : "unavailable";

  return {
    name: "host-mcp-integration",
    available: status === "ready",
    status,
    summary:
      status === "ready"
        ? `${host} host MCP wiring matches the recommended snippet and the stdio server is reachable.`
        : `${host} host MCP wiring still needs attention before host-side discovery can be trusted.`
  };
};

export const applyHostMcpCapabilityToDoctorReport = (
  report: DoctorReport,
  host: string
): DoctorReport => {
  const capability = buildHostMcpCapability(host, report.checks);
  const capabilities = [...report.capabilities, capability];

  if (capability.status === "unavailable") {
    return {
      ...report,
      capabilities,
      status: "unavailable",
      ok: false,
      summary:
        report.summary.startsWith("unavailable:")
          ? `${report.summary} Host MCP integration for ${host} also needs attention.`
          : `unavailable: cw is bound to ${report.activeRootDir}, but host MCP integration for ${host} still needs attention before the workflow is reliable.`
    };
  }

  return {
    ...report,
    capabilities,
    summary:
      report.status === "ready"
        ? `ready: cw is bound to ${report.activeRootDir}, core task workflows are available, and host MCP integration for ${host} is ready.`
        : report.summary
  };
};

export const finalizeDoctorReport = (input: {
  hostMcpHost?: string;
  report: DoctorReport;
  workerAvailability?: Awaited<ReturnType<typeof buildWorkerAvailabilitySnapshot>>;
}): DoctorReport => {
  let report = input.report;

  if (input.workerAvailability) {
    report = applyWorkerAvailabilityToDoctorReport(
      report,
      input.workerAvailability
    );
  }

  if (input.hostMcpHost) {
    report = applyHostMcpCapabilityToDoctorReport(report, input.hostMcpHost);
  }

  return report;
};

export const buildDoctorReport = async (input: {
  additionalChecks?: DoctorCheck[];
  context: ExecutionContext;
  hostMcpHost?: string;
  probe?: boolean;
  workerId?: string;
}): Promise<DoctorReport> => {
  const report = await runDoctor(input.context, {
    skipLocalClientCommandCheck: true,
    additionalChecks: [
      ...(await createWorkerDoctorChecks(input.context, {
        probe: input.probe,
        workerId: input.workerId
      })),
      ...(input.additionalChecks ?? [])
    ]
  });
  const workerAvailability = input.workerId
    ? await buildWorkerAvailabilitySnapshot({
        context: input.context,
        probe: input.probe,
        workerId: input.workerId
      })
    : undefined;

  return finalizeDoctorReport({
    report,
    hostMcpHost: input.hostMcpHost,
    workerAvailability
  });
};
