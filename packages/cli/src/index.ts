import { Command } from "commander";

import { registerAuditCommand } from "./commands/audit.js";
import { registerCleanupCommand } from "./commands/cleanup.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixCommand } from "./commands/fix.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerPatchCommand } from "./commands/patch.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerRunCommand } from "./commands/run.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerWorkerCommand } from "./commands/worker.js";

export interface CliIo {
  error: (message: string) => void;
  write: (message: string) => void;
}

const defaultIo: CliIo = {
  write: (message) => {
    process.stdout.write(`${message}\n`);
  },
  error: (message) => {
    process.stderr.write(`${message}\n`);
  }
};

export const buildCli = (io: CliIo = defaultIo): Command => {
  const program = new Command();

  program
    .name("ao")
    .description("Agent Orchestrator CLI for leader-worker engineering workflows.")
    .showHelpAfterError()
    .configureOutput({
      writeErr: io.error,
      writeOut: io.write
    });

  registerPlanCommand(program, io);
  registerInitCommand(program, io);
  registerRunCommand(program, io);
  registerSetupCommand(program, io);
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
