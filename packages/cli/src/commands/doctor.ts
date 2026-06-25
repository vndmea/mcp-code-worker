import type { Command } from "commander";

import {
  resolveExecutionContext,
  runDoctor,
  writeAuditEvent
} from "@agent-orchestrator/core";
import { createWorkerProfileDoctorChecks } from "@agent-orchestrator/models";

import type { CliIo } from "../index.js";

export const registerDoctorCommand = (program: Command, io: CliIo): void => {
  program
    .command("doctor")
    .description("Inspect resolved configuration and local workflow prerequisites.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const report = await runDoctor(context, {
        additionalChecks: await createWorkerProfileDoctorChecks(context)
      });
      await writeAuditEvent(context, {
        actor: "cli",
        action: "doctor",
        mode: context.dryRun ? "dry-run" : "execute",
        inputSummary: "ao doctor",
        outputSummary: `Doctor completed with ok=${String(report.ok)}.`,
        warnings: report.checks
          .filter((check) => check.status === "warning")
          .map((check) => check.message),
        errors: report.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.message)
      });

      io.write(JSON.stringify(report, null, 2));
    });
};
