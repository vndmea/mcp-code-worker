import type { Command } from "commander";

import { listAuditEvents, resolveExecutionContext } from "@agent-orchestrator/core";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

export const registerAuditCommand = (program: Command, io: CliIo): void => {
  const audit = program.command("audit").description("Inspect local audit events.");

  audit
    .command("list")
    .description("List local audit events in reverse chronological order.")
    .option("--limit <count>", "Maximum number of events to return", "50")
    .action(async (options: { limit: string }) => {
      const context = await resolveExecutionContext();
      const limit = Number.parseInt(options.limit, 10);
      const events = await listAuditEvents(
        context.rootDir,
        Number.isNaN(limit) ? 50 : limit,
        context.aoStorageDir
      );

      writeOutput(
        io,
        events,
        [
          "audit events",
          ...(events.length > 0
            ? events.map(
                (event) =>
                  `${event.timestamp} ${event.action} [${event.mode}] ${event.outputSummary}`
              )
            : ["none"])
        ]
      );
    });
};
