import type { Command } from "commander";

import {
  resolveExecutionContext,
  writeAuditEvent,
  type DoctorReport
} from "@mcp-code-worker/core";
import { buildDoctorReport, HOST_MCP_CHECK_NAMES } from "@mcp-code-worker/models";
import {
  createHostMcpDoctorChecks,
  isMcpHost,
  MCP_HOSTS
} from "@mcp-code-worker/mcp-server";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

const HOST_MCP_CHECK_NAME_SET = new Set<string>(HOST_MCP_CHECK_NAMES);

const readMetadataString = (
  metadata: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = metadata[key];

  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
};

const readMetadataDisplayValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback: string
): string => {
  if (!metadata) {
    return fallback;
  }

  const value = metadata[key];

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return fallback;
};

const formatDoctorReport = (report: DoctorReport): string[] => {
  const failedChecks = report.checks.filter((check) => check.status === "fail");
  const warningChecks = report.checks.filter((check) => check.status === "warning");
  const doctorStatus: string = report.status;
  const doctorSummary: string = report.summary;
  const activeRootDir: string = report.activeRootDir;
  const capabilityPairs: string[] = [];
  const runtimeBootstrap = report.checks.find(
    (check) => check.name === "runtime-bootstrap"
  );
  const rootCheck = report.checks.find((check) => check.name === "root-dir");
  const workerModel = report.checks.find((check) => check.name === "worker-model");
  const localClientCommand = report.checks.find(
    (check) => check.name === "local-client-command"
  );
  const workerConnectivity = report.checks.find(
    (check) => check.name === "worker-connectivity"
  );
  const hostMcpChecks = report.checks.filter((check) =>
    HOST_MCP_CHECK_NAME_SET.has(check.name)
  );

  for (const capability of report.capabilities) {
    capabilityPairs.push(`${capability.name}=${capability.status}`);
  }

  const capabilitySummary: string = capabilityPairs.join(", ");
  const lines: string[] = [];

  lines.push(`cw doctor: ${doctorStatus}`);
  lines.push(doctorSummary);
  lines.push(`workspace: ${activeRootDir}`);
  if (rootCheck?.metadata) {
    lines.push(
      `binding: rootSource=${readMetadataString(rootCheck.metadata, "rootSource", "unknown")} | caller=${readMetadataString(rootCheck.metadata, "callerWorkingDirectory", "unknown")}`
    );
  }
  if (runtimeBootstrap?.metadata) {
    lines.push(
      `paths: config=${readMetadataString(runtimeBootstrap.metadata, "configPath", "unknown")} | storage=${readMetadataString(runtimeBootstrap.metadata, "cwStorageDir", "unknown")} | home=${readMetadataString(runtimeBootstrap.metadata, "cwHomeDir", "unknown")}`
    );
  }
  if (workerModel?.metadata) {
    lines.push(
      `worker: provider=${readMetadataString(workerModel.metadata, "provider", "unknown")} | model=${readMetadataString(workerModel.metadata, "model", "unknown")} | baseURL=${readMetadataString(workerModel.metadata, "baseURL", "(default)")} | client=${readMetadataString(workerModel.metadata, "clientCommand", "(default)")}`
    );
  }
  if (localClientCommand?.metadata) {
    lines.push(
      `local client: status=${localClientCommand.status} | configured=${readMetadataString(localClientCommand.metadata, "configuredCommand", "(default)")} | resolved=${readMetadataString(localClientCommand.metadata, "resolvedCommand", readMetadataString(localClientCommand.metadata, "command", "(default)"))} | source=${readMetadataString(localClientCommand.metadata, "source", "unknown")}`
    );
  }
  if (workerConnectivity?.metadata) {
    lines.push(
      `probe: worker=${readMetadataString(workerConnectivity.metadata, "workerId", "(not-specified)")} | source=${readMetadataString(workerConnectivity.metadata, "source", "active-runtime")} | provider=${readMetadataString(workerConnectivity.metadata, "provider", "unknown")} | model=${readMetadataString(workerConnectivity.metadata, "model", "unknown")} | baseURL=${readMetadataString(workerConnectivity.metadata, "baseURL", "(default)")} | client=${readMetadataString(workerConnectivity.metadata, "resolvedCommand", readMetadataString(workerConnectivity.metadata, "clientCommand", "(default)"))} | clientSource=${readMetadataString(workerConnectivity.metadata, "clientCommandSource", "unknown")}`
    );
  }
  if (hostMcpChecks.length > 0) {
    lines.push(
      `mcp host: ${readMetadataDisplayValue(hostMcpChecks[0]?.metadata, "host", "unknown")}`
    );
    for (const check of hostMcpChecks) {
      lines.push(
        `mcp ${check.name}: ${check.status} | found=${readMetadataDisplayValue(check.metadata, "found", "(unknown)")} | expected=${readMetadataDisplayValue(check.metadata, "expected", "(unknown)")}`
      );
      lines.push(
        `mcp ${check.name} fix: ${readMetadataDisplayValue(check.metadata, "fix", "(none)")}`
      );
    }
  }
  lines.push(`capabilities: ${capabilitySummary}`);

  if (failedChecks.length > 0) {
    lines.push(
      `blocking: ${failedChecks
        .slice(0, 3)
        .map((check) => `${check.name}: ${check.message}`)
        .join(" | ")}`
    );
  }

  if (warningChecks.length > 0) {
    lines.push(
      `warnings: ${warningChecks
        .slice(0, 3)
        .map((check) => `${check.name}: ${check.message}`)
        .join(" | ")}`
    );
  }

  if (report.recommendedActions.length > 0) {
    lines.push(`next: ${report.recommendedActions.slice(0, 3).join(" | ")}`);
  }

  return lines;
};

export const registerDoctorCommand = (program: Command, io: CliIo): void => {
  program
    .command("doctor")
    .description("Inspect resolved configuration and local workflow prerequisites.")
    .option(
      "--probe",
      "Run a real worker connectivity probe after the static prerequisite checks.",
      false
    )
    .option(
      "--mcp",
      "Run host-level MCP configuration, launchability, connectivity, and tool-catalog checks.",
      false
    )
    .option(
      "--host <name>",
      `Target host preset for --mcp checks: ${MCP_HOSTS.join(", ")}`,
      "codex"
    )
    .option("--worker <workerId>", "Worker id to include in readiness and probe checks")
    .action(
      async (options: {
        host?: string;
        mcp?: boolean;
        probe?: boolean;
        worker?: string;
      }) => {
        const requestedHost = options.host ?? "codex";

        if (!isMcpHost(requestedHost)) {
          throw new Error(
            `Unsupported MCP host '${requestedHost}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
          );
        }

        const context = await resolveExecutionContext();
        const hostChecks = options.mcp
          ? await createHostMcpDoctorChecks(context, requestedHost)
          : [];
        const report = await buildDoctorReport({
          additionalChecks: hostChecks,
          context,
          hostMcpHost: options.mcp ? requestedHost : undefined,
          probe: options.probe,
          workerId: options.worker
        });

        const commandParts = ["cw", "doctor"];
        if (options.probe) {
          commandParts.push("--probe");
        }
        if (options.worker) {
          commandParts.push("--worker", options.worker);
        }
        if (options.mcp) {
          commandParts.push("--mcp", "--host", requestedHost);
        }

        await writeAuditEvent(context, {
          actor: "cli",
          action: "doctor",
          mode: context.dryRun ? "dry-run" : "execute",
          inputSummary: commandParts.join(" "),
          outputSummary: `Doctor completed with ok=${String(report.ok)}.`,
          warnings: report.checks
            .filter((check) => check.status === "warning")
            .map((check) => check.message),
          errors: report.checks
            .filter((check) => check.status === "fail")
            .map((check) => check.message)
        });

        writeOutput(io, report, formatDoctorReport(report));
      }
    );
};
