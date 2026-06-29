import type { Command } from "commander";

import { resolveExecutionContext } from "@mcp-code-worker/core";
import {
  formatFixErrorWorkflowOutput,
  runFixErrorWorkflow
} from "@mcp-code-worker/graph";

import type { CliIo } from "../index.js";
import {
  isHumanOutput,
  resolveWorkflowOutputOptions,
  writeJson,
  writeText
} from "../output.js";

const formatFixSummaryText = (summary: Record<string, unknown>): string[] => {
  const rootCauseAnalysis =
    typeof summary["rootCauseAnalysis"] === "string"
      ? summary["rootCauseAnalysis"]
      : null;
  const candidateFixPlan = Array.isArray(summary["candidateFixPlan"])
    ? (summary["candidateFixPlan"] as string[])
    : [];
  const validation =
    typeof summary["validation"] === "object" && summary["validation"] !== null
      ? (summary["validation"] as { summary?: string })
      : null;
  const patch =
    typeof summary["patch"] === "object" && summary["patch"] !== null
      ? (summary["patch"] as { inspectionOk?: boolean; proposalId?: string; title?: string })
      : null;

  const lines: string[] = ["fix analysis complete"];

  if (rootCauseAnalysis) {
    lines.push(`root cause: ${rootCauseAnalysis}`);
  }

  if (candidateFixPlan.length > 0) {
    lines.push(`plan: ${candidateFixPlan.slice(0, 3).join(" | ")}`);
  }

  if (validation?.summary) {
    lines.push(`validation: ${validation.summary}`);
  }

  if (patch) {
    lines.push(
      `patch: ${patch.proposalId ?? "pending"}${patch.title ? ` (${patch.title})` : ""}, inspection=${patch.inspectionOk === true ? "ok" : patch.inspectionOk === false ? "blocked" : "not-run"}`
    );
  }

  return lines;
};

export const registerFixCommand = (program: Command, io: CliIo): void => {
  const fix = program.command("fix").description("Analyze failures and propose a fix plan.");

  fix
    .command("error")
    .description("Analyze an error log and return a candidate fix plan.")
    .requiredOption("--worker <workerId>", "Registered worker id")
    .option("--error-log <text>", "Inline error log")
    .option("--error-log-file <path>", "Path to an error log file")
    .option("--propose-patch", "Generate a candidate patch proposal", false)
    .option("--scope <scope>", "Optional package or directory scope")
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--summary", "Print a summary instead of the full fix output", false)
    .option("--full", "Force the full fix output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(
      async (options: {
        errorLog?: string;
        errorLogFile?: string;
        full: boolean;
        lint: boolean;
        maxBytes?: number;
        proposePatch: boolean;
        scope?: string;
        summary: boolean;
        test: boolean;
        typecheck: boolean;
        worker: string;
      }) => {
        const context = await resolveExecutionContext();
        const result = await runFixErrorWorkflow({
          context,
          errorLog: options.errorLog,
          errorLogFile: options.errorLogFile,
          proposePatch: options.proposePatch,
          scope: options.scope,
          workerId: options.worker,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          }
        });

        const formatted = formatFixErrorWorkflowOutput(
          result,
          resolveWorkflowOutputOptions(options)
        );

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeText(io, formatFixSummaryText(formatted as Record<string, unknown>));
          return;
        }

        writeJson(io, formatted);
      }
    );
};
