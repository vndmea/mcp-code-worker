import type { Command } from "commander";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { runFixErrorWorkflow } from "@agent-orchestrator/graph";

import type { CliIo } from "../index.js";

export const registerFixCommand = (program: Command, io: CliIo): void => {
  const fix = program.command("fix").description("Analyze failures and propose a fix plan.");

  fix
    .command("error")
    .description("Analyze an error log and return a candidate fix plan.")
    .option("--error-log <text>", "Inline error log")
    .option("--error-log-file <path>", "Path to an error log file")
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--scope <scope>", "Optional package or directory scope")
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .action(
      async (options: {
        errorLog?: string;
        errorLogFile?: string;
        lint: boolean;
        proposePatch: boolean;
        scope?: string;
        test: boolean;
        typecheck: boolean;
      }) => {
        const context = createExecutionContextFromEnv();
        const result = await runFixErrorWorkflow({
          context,
          errorLog: options.errorLog,
          errorLogFile: options.errorLogFile,
          proposePatch: options.proposePatch,
          scope: options.scope,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          }
        });

        io.write(JSON.stringify(result, null, 2));
      }
    );
};
