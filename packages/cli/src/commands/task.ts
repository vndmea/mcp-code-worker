import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatTaskSessionListOutput,
  formatTaskSessionReportOutput,
  formatTaskSessionStatusOutput,
  formatTaskSessionWorkflowOutput,
  getTaskSessionReport,
  getTaskSessionStatus,
  listStoredTaskSessions,
  resumeTaskSessionWorkflow,
  runTaskSessionWorkflow
} from "@agent-orchestrator/graph";

import type { CliIo } from "../index.js";
import { resolveWorkflowOutputOptions, writeJson } from "../output.js";

export const registerTaskCommand = (program: Command, io: CliIo): void => {
  const task = program.command("task").description("Manage local end-to-end task sessions.");

  task
    .command("start")
    .requiredOption("--goal <goal>", "Task goal")
    .option("--scope <scope>", "Optional scope")
    .option("--worker <workerId>", "Optional worker id")
    .option("--require-profile", "Require a persisted worker profile", false)
    .option("--error-log <text>", "Inline error log for fix planning")
    .option("--error-log-file <path>", "Repository-local error log file for fix planning")
    .option("--run-fix", "Run fix planning before patch proposal", false)
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--inspect-patch", "Persist patch inspection details", false)
    .option("--apply-patch", "Attempt gated patch application", false)
    .option("--allow-write", "Allow repository writes for patch apply", false)
    .option("--allow-dirty-worktree", "Allow patch apply when the git worktree is dirty", false)
    .option("--confirm-apply", "Confirm patch application", false)
    .option("--allow-write-session", "Persist session files under .ao/runs", false)
    .option("--summary", "Print a summary instead of the full workflow output", false)
    .option("--full", "Force the full workflow output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .option("--no-artifact-refs", "Hide artifact refs in summary output")
    .action(
      async (options: {
        artifactRefs: boolean;
        allowWrite: boolean;
        allowDirtyWorktree: boolean;
        allowWriteSession: boolean;
        applyPatch: boolean;
        confirmApply: boolean;
        errorLog?: string;
        errorLogFile?: string;
        full: boolean;
        goal: string;
        inspectPatch: boolean;
        lint: boolean;
        maxBytes?: number;
        proposePatch: boolean;
        requireProfile: boolean;
        runFix: boolean;
        scope?: string;
        summary: boolean;
        test: boolean;
        typecheck: boolean;
        worker?: string;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            ...(options.allowWrite
              ? {
                  allowWrite: true,
                  dryRun: false
                }
              : {})
          }
        });
        const result = await runTaskSessionWorkflow({
          context,
          errorLog: options.errorLog,
          errorLogFile: options.errorLogFile,
          goal: options.goal,
          scope: options.scope,
          workerId: options.worker,
          requireProfile: options.requireProfile,
          runFix: options.runFix,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          },
          proposePatch: options.proposePatch,
          inspectPatch: options.inspectPatch,
          applyPatch: options.applyPatch,
          allowWrite: options.allowWrite,
          allowDirtyWorktree: options.allowDirtyWorktree,
          confirmApply: options.confirmApply,
          allowWriteSession: options.allowWriteSession
        });

        writeJson(io, formatTaskSessionWorkflowOutput(result, resolveWorkflowOutputOptions(options)));
      }
    );

  task
    .command("status")
    .argument("<taskId>", "Task session id")
    .option("--summary", "Print a summary instead of the full session JSON", false)
    .option("--full", "Force the full session JSON", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .option("--no-artifact-refs", "Hide artifact refs in summary output")
    .action(async (
      taskId: string,
      options: {
        artifactRefs: boolean;
        full: boolean;
        maxBytes?: number;
        summary: boolean;
      }
    ) => {
      const context = await resolveExecutionContext();
      const session = await getTaskSessionStatus(context.rootDir, taskId);
      writeJson(io, formatTaskSessionStatusOutput(session, resolveWorkflowOutputOptions(options)));
    });

  task
    .command("resume")
    .argument("<taskId>", "Task session id")
    .option("--from-step <stepId>", "Resume from a specific step")
    .option("--error-log <text>", "Inline error log for rerunning fix planning")
    .option("--error-log-file <path>", "Repository-local error log file for rerunning fix planning")
    .option("--run-fix", "Run fix planning before patch proposal", false)
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--inspect-patch", "Persist patch inspection details", false)
    .option("--apply-patch", "Attempt gated patch application", false)
    .option("--allow-write", "Allow repository writes for patch apply", false)
    .option("--allow-dirty-worktree", "Allow patch apply when the git worktree is dirty", false)
    .option("--confirm-apply", "Confirm patch application", false)
    .option("--allow-write-session", "Persist session files under .ao/runs", false)
    .option("--summary", "Print a summary instead of the full workflow output", false)
    .option("--full", "Force the full workflow output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .option("--no-artifact-refs", "Hide artifact refs in summary output")
    .action(
      async (
        taskId: string,
        options: {
          artifactRefs: boolean;
          allowWrite: boolean;
          allowDirtyWorktree: boolean;
          allowWriteSession: boolean;
          applyPatch: boolean;
          confirmApply: boolean;
          errorLog?: string;
          errorLogFile?: string;
          full: boolean;
          fromStep?: string;
          inspectPatch: boolean;
          maxBytes?: number;
          proposePatch: boolean;
          runFix: boolean;
          summary: boolean;
        }
      ) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            ...(options.allowWrite
              ? {
                  allowWrite: true,
                  dryRun: false
                }
              : {})
          }
        });
        const result = await resumeTaskSessionWorkflow({
          context,
          taskId,
          errorLog: options.errorLog,
          errorLogFile: options.errorLogFile,
          fromStep: options.fromStep,
          proposePatch: options.proposePatch,
          inspectPatch: options.inspectPatch,
          runFix: options.runFix,
          applyPatch: options.applyPatch,
          allowWrite: options.allowWrite,
          allowDirtyWorktree: options.allowDirtyWorktree,
          confirmApply: options.confirmApply,
          allowWriteSession: options.allowWriteSession
        });

        writeJson(io, formatTaskSessionWorkflowOutput(result, resolveWorkflowOutputOptions(options)));
      }
    );

  task
    .command("report")
    .argument("<taskId>", "Task session id")
    .option("--summary", "Print a JSON summary instead of markdown", false)
    .option("--full", "Print the full JSON payload instead of markdown", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .option("--no-artifact-refs", "Hide artifact refs in summary output")
    .action(async (
      taskId: string,
      options: {
        artifactRefs: boolean;
        full: boolean;
        maxBytes?: number;
        summary: boolean;
      }
    ) => {
      const context = await resolveExecutionContext();
      const report = await getTaskSessionReport(context.rootDir, taskId);

      if (options.summary || options.full) {
        writeJson(io, formatTaskSessionReportOutput(report, resolveWorkflowOutputOptions(options)));
        return;
      }

      io.write(report.report);
    });

  task
    .command("list")
    .option("--limit <count>", "Maximum number of task sessions to return", "50")
    .option("--summary", "Print a summary instead of the full session list", false)
    .option("--full", "Force the full session list", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .option("--no-artifact-refs", "Hide artifact refs in summary output")
    .action(async (options: {
      artifactRefs: boolean;
      full: boolean;
      limit: string;
      maxBytes?: number;
      summary: boolean;
    }) => {
      const context = await resolveExecutionContext();
      const limit = Number.parseInt(options.limit, 10);
      const sessions = await listStoredTaskSessions(
        context.rootDir,
        Number.isNaN(limit) ? 50 : limit
      );
      writeJson(io, formatTaskSessionListOutput(sessions, resolveWorkflowOutputOptions(options)));
    });
};
