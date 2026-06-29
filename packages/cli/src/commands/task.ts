import type { Command } from "commander";

import { resolveExecutionContext } from "@mcp-code-worker/core";
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
} from "@mcp-code-worker/graph";

import type { CliIo } from "../index.js";
import {
  isHumanOutput,
  resolveWorkflowOutputOptions,
  writeHumanText,
  writeJson
} from "../output.js";
import { resolveCommandContext } from "./command-runtime.js";

const formatTaskSessionSummaryText = (summary: Record<string, unknown>): string[] => {
  const taskId = typeof summary["taskId"] === "string" ? summary["taskId"] : "unknown-task";
  const status =
    typeof summary["finalStatus"] === "string"
      ? summary["finalStatus"]
      : typeof summary["status"] === "string"
        ? summary["status"]
        : "unknown";
  const goal = typeof summary["goal"] === "string" ? summary["goal"] : "";
  const humanSummary =
    typeof summary["humanSummary"] === "string" ? summary["humanSummary"] : null;
  const outcomeSummary =
    typeof summary["outcomeSummary"] === "string"
      ? summary["outcomeSummary"]
      : null;
  const nextRecommendedActions = Array.isArray(summary["nextRecommendedActions"])
    ? summary["nextRecommendedActions"]
        .map((value) => {
          if (typeof value === "string") {
            return value;
          }

          if (!value || typeof value !== "object") {
            return null;
          }

          const action = value as {
            action?: unknown;
            command?: unknown;
            reason?: unknown;
          };

          if (typeof action.command === "string" && action.command.length > 0) {
            return action.command;
          }

          if (typeof action.reason === "string" && action.reason.length > 0) {
            return action.reason;
          }

          if (typeof action.action === "string" && action.action.length > 0) {
            return action.action;
          }

          return null;
        })
        .filter((value): value is string => Boolean(value))
    : [];
  const readinessSummary =
    typeof summary["readinessSummary"] === "string"
      ? summary["readinessSummary"]
      : null;
  const transientNotice =
    typeof summary["transientNotice"] === "string"
      ? summary["transientNotice"]
      : null;
  const sessionPath =
    typeof summary["sessionPath"] === "string" ? summary["sessionPath"] : null;
  const reviewSummary =
    typeof summary["reviewSummary"] === "string" ? summary["reviewSummary"] : null;
  const fixSummary =
    typeof summary["fixSummary"] === "string" ? summary["fixSummary"] : null;
  const workerReviewStatus =
    typeof summary["workerReviewStatus"] === "string"
      ? summary["workerReviewStatus"]
      : null;
  const accepted =
    typeof summary["accepted"] === "boolean" || typeof summary["accepted"] === "string"
      ? summary["accepted"]
      : null;
  const validationSummary =
    typeof summary["validationSummary"] === "string"
      ? summary["validationSummary"]
      : null;
  const validation =
    typeof summary["validation"] === "object" && summary["validation"] !== null
      ? (summary["validation"] as { summary?: string })
      : null;
  const localClientRuntime =
    typeof summary["localClientRuntime"] === "object" &&
    summary["localClientRuntime"] !== null
      ? (summary["localClientRuntime"] as {
          configuredCommand?: unknown;
          resolvedCommand?: unknown;
          source?: unknown;
        })
      : null;

  const lines: string[] = [`task ${taskId}: ${status}`];

  if (goal) {
    lines.push(`goal: ${goal}`);
  }

  if (humanSummary) {
    lines.push(humanSummary);
  }

  if (outcomeSummary) {
    lines.push(`outcome: ${outcomeSummary}`);
  }

  if (readinessSummary) {
    lines.push(readinessSummary);
  }

  if (reviewSummary) {
    lines.push(`review: ${reviewSummary}`);
  }

  if (workerReviewStatus) {
    lines.push(`worker review: ${workerReviewStatus}`);
  }

  if (accepted !== null) {
    lines.push(`accepted: ${String(accepted)}`);
  }

  if (fixSummary) {
    lines.push(`fix: ${fixSummary}`);
  }

  if (localClientRuntime) {
    lines.push(
      `local client: configured=${typeof localClientRuntime.configuredCommand === "string" ? localClientRuntime.configuredCommand : "(default)"} | resolved=${typeof localClientRuntime.resolvedCommand === "string" ? localClientRuntime.resolvedCommand : "(unknown)"} | source=${typeof localClientRuntime.source === "string" ? localClientRuntime.source : "unknown"}`
    );
  }

  if (validationSummary) {
    lines.push(`validation: ${validationSummary}`);
  } else if (validation?.summary) {
    lines.push(`validation: ${validation.summary}`);
  }

  if (sessionPath) {
    lines.push(`session: ${sessionPath}`);
  }

  if (transientNotice) {
    lines.push(`note: ${transientNotice}`);
  }

  if (nextRecommendedActions.length > 0) {
    lines.push(`next: ${nextRecommendedActions.slice(0, 3).join(" | ")}`);
  }

  return lines;
};

const writeTaskOutput = (
  io: CliIo,
  value: Record<string, unknown>
): void => {
  if (isHumanOutput(io)) {
    writeHumanText(io, formatTaskSessionSummaryText(value));
    return;
  }

  writeJson(io, value);
};

export const registerTaskCommand = (program: Command, io: CliIo): void => {
  const task = program.command("task").description("Manage local end-to-end task sessions.");

  task
    .command("start")
    .requiredOption("--goal <goal>", "Task goal")
    .option("--scope <scope>", "Optional scope")
    .requiredOption("--worker <workerId>", "Worker id")
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
    .option("--allow-write-session", "Persist session files under user-scoped cw workspace storage", false)
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
        worker: string;
      }) => {
        const context = await resolveCommandContext({
          allowWrite: options.allowWrite
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

        const workflowOutputOptions = resolveWorkflowOutputOptions(options);
        const formatted = formatTaskSessionWorkflowOutput(
          result,
          workflowOutputOptions
        ) as Record<string, unknown>;

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeTaskOutput(
            io,
            formatTaskSessionWorkflowOutput(result, {
              ...workflowOutputOptions,
              detailLevel: "summary"
            }) as Record<string, unknown>
          );
          return;
        }

        writeJson(io, formatted);
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
      const session = await getTaskSessionStatus(
        context.rootDir,
        taskId,
        context.cwStorageDir
      );
      const formatted = formatTaskSessionStatusOutput(
        session,
        resolveWorkflowOutputOptions(options)
      ) as Record<string, unknown>;

      if (isHumanOutput(io) && !options.summary && !options.full) {
        const humanFormatted = formatTaskSessionStatusOutput(session, {
          ...resolveWorkflowOutputOptions(options),
          detailLevel: "summary"
        });

        writeTaskOutput(
          io,
          humanFormatted
        );
        return;
      }

      writeJson(io, formatted);
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
    .option("--allow-write-session", "Persist session files under user-scoped cw workspace storage", false)
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
        const context = await resolveCommandContext({
          allowWrite: options.allowWrite
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

        const formatted = formatTaskSessionWorkflowOutput(
          result,
          resolveWorkflowOutputOptions(options)
        ) as Record<string, unknown>;

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeTaskOutput(
            io,
            formatTaskSessionWorkflowOutput(result, {
              ...resolveWorkflowOutputOptions(options),
              detailLevel: "summary"
            }) as Record<string, unknown>
          );
          return;
        }

        writeJson(io, formatted);
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
      const report = await getTaskSessionReport(
        context.rootDir,
        taskId,
        context.cwStorageDir
      );

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
        Number.isNaN(limit) ? 50 : limit,
        context.cwStorageDir
      );
      const formatted = formatTaskSessionListOutput(
        sessions,
        resolveWorkflowOutputOptions(options)
      );

      if (isHumanOutput(io) && !options.summary && !options.full) {
        const lines = (formatted as Array<Record<string, unknown>>).flatMap((session) =>
          formatTaskSessionSummaryText(session).concat("")
        );
        writeHumanText(io, lines.slice(0, Math.max(0, lines.length - 1)));
        return;
      }

      writeJson(io, formatted);
    });
};
