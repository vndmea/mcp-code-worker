import { Command } from "commander";

import { registerAuditCommand } from "./commands/audit.js";
import { registerCleanupCommand } from "./commands/cleanup.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixCommand } from "./commands/fix.js";
import {
  registerInitCommand,
  type InitPrompter
} from "./commands/init.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerPatchCommand } from "./commands/patch.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerWorkerCommand } from "./commands/worker.js";

export interface CliIo {
  outputMode?: "human" | "json";
  error: (message: string) => void;
  write: (message: string) => void;
}

export interface CliDependencies {
  initPrompter?: InitPrompter;
  pathOpener?: (targetPath: string) => Promise<boolean>;
}

const defaultIo: CliIo = {
  outputMode: process.stdout.isTTY ? "human" : "json",
  write: (message) => {
    process.stdout.write(`${message}\n`);
  },
  error: (message) => {
    process.stderr.write(`${message}\n`);
  }
};

export const buildCli = (
  io: CliIo = defaultIo,
  dependencies: CliDependencies = {}
): Command => {
  const program = new Command();

  program
    .name("cw")
    .description("MCP Code Worker CLI for controlled worker execution, validation, and task artifacts.")
    .showHelpAfterError()
    .configureOutput({
      writeErr: io.error,
      writeOut: io.write
    });

  registerSetupCommand(program, io);
  registerInitCommand(
    program,
    io,
    dependencies.initPrompter,
    dependencies.pathOpener
  );
  registerPatchCommand(program, io);
  registerReviewCommand(program, io);
  registerFixCommand(program, io);
  registerTaskCommand(program, io);
  registerValidateCommand(program, io);
  registerAuditCommand(program, io);
  registerCleanupCommand(program, io);
  registerDoctorCommand(program, io);
  registerModelsCommand(program, io);
  registerWorkerCommand(program, io);
  registerMcpCommand(program, io);

  return program;
};
