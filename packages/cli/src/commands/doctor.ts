import type { Command } from "commander";

import {
  resolveExecutionContext,
  runDoctor,
  type DoctorReport,
  writeAuditEvent
} from "@mcp-code-worker/core";
import {
  createLocalClientDoctorChecks,
  createWorkerConnectivityDoctorChecks,
  createWorkerProfileDoctorChecks
} from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

const formatDoctorReport = (report: DoctorReport): string[] => {
  const failedChecks = report.checks.filter((check) => check.status === "fail");
  const warningChecks = report.checks.filter((check) => check.status === "warning");
  const doctorStatus: string = report.status;
  const doctorSummary: string = report.summary;
  const activeRootDir: string = report.activeRootDir;
  const capabilityPairs: string[] = [];

  for (const capability of report.capabilities) {
    capabilityPairs.push(`${capability.name}=${capability.status}`);
  }

  const capabilitySummary: string = capabilityPairs.join(", ");
  const lines: string[] = [];

  lines.push(`cw doctor: ${doctorStatus}`);
  lines.push(doctorSummary);
  lines.push(`workspace: ${activeRootDir}`);
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
      "--check-worker",
      "Run a real worker connectivity probe after the static prerequisite checks.",
      false
    )
    .action(async (options: { checkWorker?: boolean }) => {
      const context = await resolveExecutionContext();
      const additionalChecks = [
        ...(await createWorkerProfileDoctorChecks(context)),
        ...(await createLocalClientDoctorChecks(context)),
        ...(options.checkWorker
          ? await createWorkerConnectivityDoctorChecks(context)
          : [])
      ];
      const report = await runDoctor(context, {
        additionalChecks
      });
      await writeAuditEvent(context, {
        actor: "cli",
        action: "doctor",
        mode: context.dryRun ? "dry-run" : "execute",
        inputSummary: options.checkWorker ? "cw doctor --check-worker" : "cw doctor",
        outputSummary: `Doctor completed with ok=${String(report.ok)}.`,
        warnings: report.checks
          .filter((check) => check.status === "warning")
          .map((check) => check.message),
        errors: report.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.message)
      });

      writeOutput(io, report, formatDoctorReport(report));
    });
};
