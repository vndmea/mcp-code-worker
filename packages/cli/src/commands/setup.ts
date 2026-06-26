import type { Command } from "commander";

import { resolveExecutionContext, runDoctor } from "@agent-orchestrator/core";
import { createWorkerProfileDoctorChecks } from "@agent-orchestrator/models";

import type { CliIo } from "../index.js";

export const registerSetupCommand = (program: Command, io: CliIo): void => {
  program
    .command("setup")
    .description("Show the guided onboarding path for making this workspace ready for ao tasks.")
    .action(async () => {
      const context = await resolveExecutionContext();
      const report = await runDoctor(context, {
        additionalChecks: await createWorkerProfileDoctorChecks(context)
      });
      const setupSteps = [
        {
          id: "bind-workspace",
          status: report.workspaceBinding.matchesCallerWorkingDirectory
            ? "ready"
            : "needs-review",
          summary: report.workspaceBinding.matchesCallerWorkingDirectory
            ? `ao is bound to the current workspace: ${report.activeRootDir}`
            : `ao is bound to ${report.activeRootDir} instead of ${report.workspaceBinding.callerWorkingDirectory}`,
          command: "ao doctor"
        },
        {
          id: "configure-models",
          status:
            report.checks.some((check) => check.name === "leader-api-key" && check.status !== "pass") ||
            report.checks.some((check) => check.name === "worker-api-key" && check.status !== "pass")
              ? "needs-review"
              : "ready",
          summary:
            "Confirm the leader and worker model configuration, plus API keys or local client access.",
          command: "ao doctor"
        },
        {
          id: "register-worker",
          status:
            report.checks.some((check) => check.name === "worker-registry" && check.status === "pass")
              ? "ready"
              : "needs-review",
          summary:
            "Register a worker only if you need explicit worker selection beyond the default fallback worker.",
          command: "ao worker register --provider <provider> --model <model> --allow-write"
        },
        {
          id: "interview-worker",
          status:
            report.checks.some(
              (check) =>
                (check.name === "default-worker-profile" ||
                  check.name === "registered-worker-profile") &&
                check.status === "pass"
            )
              ? "ready"
              : "needs-review",
          summary:
            "Persist a worker interview so ao can route tasks with less guesswork.",
          command: "ao worker interview --save"
        },
        {
          id: "map-validation",
          status:
            report.checks.some(
              (check) => check.name === "validation-scripts" && check.status === "pass"
            )
              ? "ready"
              : "needs-review",
          summary:
            "Map or auto-discover validation scripts so ao can prove results deterministically.",
          command:
            "Edit .ao/config.json validation.scripts, then rerun `ao doctor`."
        }
      ];

      io.write(
        JSON.stringify(
          {
            rootDir: report.activeRootDir,
            status: report.status,
            summary: report.summary,
            setupSteps,
            minimalSuccessPath: report.minimalSuccessPath,
            recommendedEntrypoints: report.recommendedEntrypoints,
            recommendedActions: report.recommendedActions.slice(0, 5)
          },
          null,
          2
        )
      );
    });
};
