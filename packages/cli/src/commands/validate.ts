import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { runRepositoryValidation } from "@agent-orchestrator/tools";

import type { CliIo } from "../index.js";

export const registerValidateCommand = (program: Command, io: CliIo): void => {
  program
    .command("validate")
    .description("Run deterministic repository validation checks.")
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--execute", "Execute validation instead of dry-run", false)
    .action(
      async (options: {
        execute: boolean;
        lint: boolean;
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

        io.write(JSON.stringify(result, null, 2));
      }
    );
};
