import type { Command } from "commander";

import { createExecutionContextFromEnv, listAuditEvents } from "@agent-orchestrator/core";

import type { CliIo } from "../index.js";

export const registerAuditCommand = (program: Command, io: CliIo): void => {
  const audit = program.command("audit").description("Inspect local audit events.");

  audit
    .command("list")
    .description("List local audit events in reverse chronological order.")
    .option("--limit <count>", "Maximum number of events to return", "50")
    .action(async (options: { limit: string }) => {
      const context = createExecutionContextFromEnv();
      const limit = Number.parseInt(options.limit, 10);
      const events = await listAuditEvents(
        context.rootDir,
        Number.isNaN(limit) ? 50 : limit
      );

      io.write(JSON.stringify(events, null, 2));
    });
};
