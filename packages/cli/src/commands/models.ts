import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import { ModelRouter } from "@agent-orchestrator/models";

import type { CliIo } from "../index.js";

export const registerModelsCommand = (program: Command, io: CliIo): void => {
  const models = program.command("models").description("Inspect configured models.");

  models
    .command("list")
    .description("List configured leader and worker models.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const router = new ModelRouter(context.leaderModel, context.workerModel);
      io.write(JSON.stringify(router.listModels(), null, 2));
    });
};
