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

const HOST_MCP_CHECK_NAME_SET = new Set([
  "host-config-present",
  "host-config-valid",
  "mcp-server-launchable",
  "mcp-connection",
  "mcp-tool-catalog-match"
]);

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

const applyHostMcpCapability = (
  report: DoctorReport,
  host: string
): void => {
  const capability = buildHostMcpCapability(host, report.checks);
  report.capabilities.push(capability);

  if (capability.status === "unavailable") {
    report.status = "unavailable";
    report.ok = false;
    report.summary =
      report.summary.startsWith("unavailable:")
        ? `${report.summary} Host MCP integration for ${host} also needs attention.`
        : `unavailable: cw is bound to ${report.activeRootDir}, but host MCP integration for ${host} still needs attention before the workflow is reliable.`;
  } else if (report.status === "ready") {
    report.summary = `ready: cw is bound to ${report.activeRootDir}, core task workflows are available, and host MCP integration for ${host} is ready.`;
  }
};

export const buildDoctorReport = async (input: {
  additionalChecks?: DoctorCheck[];
  context: ExecutionContext;
  hostMcpHost?: string;
  probe?: boolean;
  workerId?: string;
}): Promise<DoctorReport> => {
  const report = await runDoctor(input.context, {
    additionalChecks: [
      ...(await createWorkerDoctorChecks(input.context, {
        probe: input.probe,
        workerId: input.workerId
      })),
      ...(input.additionalChecks ?? [])
    ]
  });

  if (input.workerId) {
    const workerAvailability = await buildWorkerAvailabilitySnapshot({
      context: input.context,
      probe: input.probe,
      workerId: input.workerId
    });
    applyWorkerAvailabilityToDoctorReport(report, workerAvailability);
  }

  if (input.hostMcpHost) {
    applyHostMcpCapability(report, input.hostMcpHost);
  }

  return report;
};
