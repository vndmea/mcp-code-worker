import type { Command } from "commander";

import {
  resolveExecutionContext,
  summarizeValidationReport
} from "@agent-orchestrator/core";
import { runRepositoryValidation } from "@agent-orchestrator/tools";

import type { CliIo } from "../index.js";
import { writeJson } from "../output.js";

export const registerValidateCommand = (program: Command, io: CliIo): void => {
  program
    .command("validate")
    .description("Run deterministic repository validation checks.")
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--execute", "Execute validation instead of dry-run", false)
    .option("--summary", "Print a summary instead of the full validation report", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(
      async (options: {
        execute: boolean;
        lint: boolean;
        maxBytes?: number;
        summary: boolean;
        test: boolean;
        typecheck: boolean;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            ...(options.execute ? { dryRun: false } : {})
          }
        });
        const result = await runRepositoryValidation(context, {
          typecheck: options.typecheck,
          lint: options.lint,
          test: options.test
        });

        writeJson(io, options.summary ? summarizeValidationReport(result, options.maxBytes) : result);
      }
    );
};
