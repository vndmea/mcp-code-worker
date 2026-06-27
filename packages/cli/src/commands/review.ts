import type { Command } from "commander";

import { resolveExecutionContext } from "@agent-orchestrator/core";
import {
  formatReviewWorkflowOutput,
  runReviewWorkflow
} from "@agent-orchestrator/graph";

import type { CliIo } from "../index.js";
import {
  isHumanOutput,
  resolveWorkflowOutputOptions,
  writeJson,
  writeText
} from "../output.js";

const formatReviewSummaryText = (summary: Record<string, unknown>): string[] => {
  const reviewSummary =
    typeof summary["reviewSummary"] === "string" ? summary["reviewSummary"] : null;
  const accepted =
    typeof summary["accepted"] === "boolean" ? summary["accepted"] : null;
  const validation =
    typeof summary["validation"] === "object" && summary["validation"] !== null
      ? (summary["validation"] as { summary?: string })
      : null;
  const repository =
    typeof summary["repository"] === "object" && summary["repository"] !== null
      ? (summary["repository"] as {
          diffIncluded?: boolean;
          scope?: string;
          selectedFileCount?: number;
          truncatedFileCount?: number;
          warningCount?: number;
        })
      : null;
  const workerReviewStatus =
    typeof summary["workerReviewStatus"] === "string"
      ? summary["workerReviewStatus"]
      : null;

  const lines: string[] = ["review complete"];

  if (reviewSummary) {
    lines.push(`review: ${reviewSummary}`);
  }

  if (accepted !== null) {
    lines.push(`accepted: ${accepted ? "yes" : "no"}`);
  }

  if (repository) {
    lines.push(
      `repository: files=${repository.selectedFileCount ?? 0}, warnings=${repository.warningCount ?? 0}, truncated=${repository.truncatedFileCount ?? 0}, diff=${repository.diffIncluded ? "yes" : "no"}${repository.scope ? `, scope=${repository.scope}` : ""}`
    );
  }

  if (validation?.summary) {
    lines.push(`validation: ${validation.summary}`);
  }

  if (workerReviewStatus) {
    lines.push(`worker review: ${workerReviewStatus}`);
  }

  return lines;
};

export const registerReviewCommand = (program: Command, io: CliIo): void => {
  const review = program.command("review").description("Review repository context, diffs, or files.");

  review
    .command("repo")
    .option("--scope <scope>", "Optional scope")
    .option("--max-file-bytes <bytes>", "Maximum bytes per selected file", Number)
    .option("--max-total-bytes <bytes>", "Maximum total bytes for repository context", Number)
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--summary", "Print a summary instead of the full review output", false)
    .option("--full", "Force the full review output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(async (options: {
      full: boolean;
      lint: boolean;
      maxBytes?: number;
      maxFileBytes?: number;
      maxTotalBytes?: number;
      scope?: string;
      summary: boolean;
      test: boolean;
      typecheck: boolean;
    }) => {
      const context = await resolveExecutionContext();
      const result = await runReviewWorkflow({
        context,
        maxFileBytes: options.maxFileBytes,
        maxTotalBytes: options.maxTotalBytes,
        scope: options.scope,
        validate: {
          typecheck: options.typecheck,
          lint: options.lint,
          test: options.test
        }
      });

      const formatted = formatReviewWorkflowOutput(
        result,
        resolveWorkflowOutputOptions(options)
      );

      if (isHumanOutput(io) && !options.summary && !options.full) {
        writeText(io, formatReviewSummaryText(formatted as Record<string, unknown>));
        return;
      }

      writeJson(io, formatted);
    });

  review
    .command("diff")
    .option("--base <base>", "Diff base ref")
    .option("--head <head>", "Diff head ref")
    .option("--scope <scope>", "Optional scope")
    .option("--max-file-bytes <bytes>", "Maximum bytes per selected file", Number)
    .option("--max-total-bytes <bytes>", "Maximum total bytes for repository context", Number)
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--summary", "Print a summary instead of the full review output", false)
    .option("--full", "Force the full review output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(
      async (options: {
        base?: string;
        full: boolean;
        head?: string;
        lint: boolean;
        maxBytes?: number;
        maxFileBytes?: number;
        maxTotalBytes?: number;
        scope?: string;
        summary: boolean;
        test: boolean;
        typecheck: boolean;
      }) => {
        const context = await resolveExecutionContext();
        const result = await runReviewWorkflow({
          context,
          includeDiff: true,
          diffBase: options.base,
          diffHead: options.head,
          maxFileBytes: options.maxFileBytes,
          maxTotalBytes: options.maxTotalBytes,
          scope: options.scope,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          }
        });

        const formatted = formatReviewWorkflowOutput(
          result,
          resolveWorkflowOutputOptions(options)
        );

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeText(io, formatReviewSummaryText(formatted as Record<string, unknown>));
          return;
        }

        writeJson(io, formatted);
      }
    );

  review
    .command("files")
    .requiredOption("--file <path...>", "Files to include")
    .option("--scope <scope>", "Optional scope")
    .option("--max-file-bytes <bytes>", "Maximum bytes per selected file", Number)
    .option("--max-total-bytes <bytes>", "Maximum total bytes for repository context", Number)
    .option("--typecheck", "Run typecheck", false)
    .option("--lint", "Run lint", false)
    .option("--test", "Run tests", false)
    .option("--summary", "Print a summary instead of the full review output", false)
    .option("--full", "Force the full review output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(
      async (options: {
        file: string[];
        full: boolean;
        lint: boolean;
        maxBytes?: number;
        maxFileBytes?: number;
        maxTotalBytes?: number;
        scope?: string;
        summary: boolean;
        test: boolean;
        typecheck: boolean;
      }) => {
        const context = await resolveExecutionContext();
        const result = await runReviewWorkflow({
          context,
          files: options.file,
          maxFileBytes: options.maxFileBytes,
          maxTotalBytes: options.maxTotalBytes,
          scope: options.scope,
          validate: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          }
        });

        const formatted = formatReviewWorkflowOutput(
          result,
          resolveWorkflowOutputOptions(options)
        );

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeText(io, formatReviewSummaryText(formatted as Record<string, unknown>));
          return;
        }

        writeJson(io, formatted);
      }
    );
};
