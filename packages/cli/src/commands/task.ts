import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  getTaskSessionReport,
  getTaskSessionStatus,
  listStoredTaskSessions,
  resumeTaskSessionWorkflow,
  runTaskSessionWorkflow
} from "@agent-orchestrator/graph";

import type { CliIo } from "../index.js";

export const registerTaskCommand = (program: Command, io: CliIo): void => {
  const task = program.command("task").description("Manage local end-to-end task sessions.");

  task
    .command("start")
    .requiredOption("--goal <goal>", "Task goal")
    .option("--scope <scope>", "Optional scope")
    .option("--worker <workerId>", "Optional worker id")
    .option("--require-profile", "Require a persisted worker profile", false)
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--inspect-patch", "Persist patch inspection details", false)
    .option("--apply-patch", "Attempt gated patch application", false)
    .option("--allow-write", "Allow repository writes for patch apply", false)
    .option("--confirm-apply", "Confirm patch application", false)
    .option("--allow-write-session", "Persist session files under .ao/runs", false)
    .action(
      async (options: {
        allowWrite: boolean;
        allowWriteSession: boolean;
        applyPatch: boolean;
        confirmApply: boolean;
        goal: string;
        inspectPatch: boolean;
        lint: boolean;
        proposePatch: boolean;
        requireProfile: boolean;
        scope?: string;
        test: boolean;
        typecheck: boolean;
        worker?: string;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            allowWrite: options.allowWrite,
            dryRun: !options.allowWrite
          }
        });
        const result = await runTaskSessionWorkflow({
          context,
          goal: options.goal,
          scope: options.scope,
          workerId: options.worker,
          requireProfile: options.requireProfile,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          },
          proposePatch: options.proposePatch,
          inspectPatch: options.inspectPatch,
          applyPatch: options.applyPatch,
          allowWrite: options.allowWrite,
          confirmApply: options.confirmApply,
          allowWriteSession: options.allowWriteSession
        });

        io.write(JSON.stringify(result, null, 2));
      }
    );

  task
    .command("status")
    .argument("<taskId>", "Task session id")
    .action(async (taskId: string) => {
      const context = await resolveExecutionContext();
      const session = await getTaskSessionStatus(context.rootDir, taskId);
      io.write(JSON.stringify(session, null, 2));
    });

  task
    .command("resume")
    .argument("<taskId>", "Task session id")
    .option("--from-step <stepId>", "Resume from a specific step")
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--inspect-patch", "Persist patch inspection details", false)
    .option("--apply-patch", "Attempt gated patch application", false)
    .option("--allow-write", "Allow repository writes for patch apply", false)
    .option("--confirm-apply", "Confirm patch application", false)
    .option("--allow-write-session", "Persist session files under .ao/runs", false)
    .action(
      async (
        taskId: string,
        options: {
          allowWrite: boolean;
          allowWriteSession: boolean;
          applyPatch: boolean;
          confirmApply: boolean;
          fromStep?: string;
          inspectPatch: boolean;
          proposePatch: boolean;
        }
      ) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            allowWrite: options.allowWrite,
            dryRun: !options.allowWrite
          }
        });
        const result = await resumeTaskSessionWorkflow({
          context,
          taskId,
          fromStep: options.fromStep,
          proposePatch: options.proposePatch,
          inspectPatch: options.inspectPatch,
          applyPatch: options.applyPatch,
          allowWrite: options.allowWrite,
          confirmApply: options.confirmApply,
          allowWriteSession: options.allowWriteSession
        });

        io.write(JSON.stringify(result, null, 2));
      }
    );

  task
    .command("report")
    .argument("<taskId>", "Task session id")
    .action(async (taskId: string) => {
      const context = await resolveExecutionContext();
      const report = await getTaskSessionReport(context.rootDir, taskId);
      io.write(report.report);
    });

  task
    .command("list")
    .option("--limit <count>", "Maximum number of task sessions to return", "50")
    .action(async (options: { limit: string }) => {
      const context = await resolveExecutionContext();
      const limit = Number.parseInt(options.limit, 10);
      const sessions = await listStoredTaskSessions(
        context.rootDir,
        Number.isNaN(limit) ? 50 : limit
      );
      io.write(JSON.stringify(sessions, null, 2));
    });
};
