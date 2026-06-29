import type { Command } from "commander";

import { PatchProposalSchema, resolveExecutionContext } from "@mcp-code-worker/core";
import {
  applyPatchProposal,
  inspectPatch,
  readRepositoryFile,
  writeRepositoryFile
} from "@mcp-code-worker/tools";
import {
  formatPatchProposalWorkflowOutput,
  runPatchProposalWorkflow
} from "@mcp-code-worker/graph";

import type { CliIo } from "../index.js";
import {
  isHumanOutput,
  resolveWorkflowOutputOptions,
  writeJson,
  writeOutput,
  writeText
} from "../output.js";
import { resolveCommandContext } from "./command-runtime.js";

const formatPatchInspectResult = (result: {
  inspection: {
    blockedReasons: string[];
    ok: boolean;
    warnings: string[];
  };
  proposal: {
    id: string;
    title: string;
  };
}): string[] => {
  const lines: string[] = [
    `patch ${result.proposal.id}: ${result.proposal.title}`,
    result.inspection.ok ? "inspection passed" : "inspection blocked"
  ];

  if (result.inspection.blockedReasons.length > 0) {
    lines.push(`blocked: ${result.inspection.blockedReasons.join(" | ")}`);
  }

  if (result.inspection.warnings.length > 0) {
    lines.push(`warnings: ${result.inspection.warnings.join(" | ")}`);
  }

  return lines;
};

const formatPatchApplyResult = (result: {
  applied?: boolean;
  mode?: string;
  reason?: string;
}): string[] => {
  const lines: string[] = [
    result.applied ? "patch applied" : `patch ${result.mode ?? "check"} completed`
  ];

  if (result.reason) {
    lines.push(result.reason);
  }

  return lines;
};

const toDisplayText = (value: unknown, fallback: string): string => {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return fallback;
};

const formatPatchProposalSummaryText = (summary: Record<string, unknown>): string[] => {
  const changedFiles = Array.isArray(summary["changedFiles"])
    ? (summary["changedFiles"] as Array<{ path?: string }>)
    : [];
  const inspection =
    typeof summary["inspection"] === "object" && summary["inspection"] !== null
      ? (summary["inspection"] as { blockedReasons?: string[]; ok?: boolean })
      : null;
  const warnings = Array.isArray(summary["warnings"])
    ? (summary["warnings"] as string[])
    : [];
  const deniedReason = toDisplayText(summary["deniedReason"], "");
  const humanSummary = toDisplayText(summary["humanSummary"], "");
  const proposalId = toDisplayText(summary["proposalId"], "unknown");
  const proposalState = toDisplayText(summary["proposalState"], "unknown");
  const title = toDisplayText(summary["title"], "");
  const patchLine = proposalState === "ready-for-review"
    ? "patch: ready for review"
    : proposalState === "placeholder"
      ? "patch: placeholder only, do not apply"
      : proposalState === "blocked"
        ? "patch: blocked"
        : `patch: ${proposalState}`;

  const lines: string[] = [
    patchLine,
    `proposal ${proposalId}: ${title}`.trim(),
    `changed files: ${changedFiles.length}`
  ];

  if (typeof summary["summary"] === "string") {
    lines.push(summary["summary"]);
  }

  if (humanSummary) {
    lines.push(humanSummary);
  }

  if (deniedReason) {
    lines.push(`denied: ${deniedReason}`);
  }

  if (changedFiles.length > 0) {
    lines.push(
      `files: ${changedFiles
        .slice(0, 5)
        .map((file) => file.path ?? "unknown")
        .join(", ")}`
    );
  }

  if (inspection) {
    lines.push(`inspection: ${inspection.ok ? "ok" : "blocked"}`);
  }

  if (inspection?.blockedReasons && inspection.blockedReasons.length > 0) {
    lines.push(`blocked: ${inspection.blockedReasons.join(" | ")}`);
  }

  if (warnings.length > 0) {
    lines.push(`warnings: ${warnings.join(" | ")}`);
  }

  return lines;
};

const parsePatchProposalFile = async (patchFile: string, rootDir: string) => {
  const contents = await readRepositoryFile(patchFile, rootDir);

  try {
    return PatchProposalSchema.parse(JSON.parse(contents) as unknown);
  } catch {
    return PatchProposalSchema.parse({
      id: `patch-${Date.now()}`,
      title: `Imported patch from ${patchFile}`,
      summary: `Imported raw unified diff from ${patchFile}.`,
      rationale: ["Imported from patch file for manual review."],
      unifiedDiff: contents,
      files: [],
      risks: [],
      validationPlan: [],
      generatedAt: new Date().toISOString(),
      source: {
        workflow: "patch-file-import"
      }
    });
  }
};

export const registerPatchCommand = (program: Command, io: CliIo): void => {
  const patch = program.command("patch").description("Inspect, propose, and apply gated patch artifacts.");

  patch
    .command("inspect")
    .argument("<patchFile>", "Patch proposal file")
    .option("--scope <scope>", "Restrict inspection to a repository scope")
    .action(async (patchFile: string, options: { scope?: string }) => {
      const context = await resolveCommandContext({
        forceExecute: true
      });
      const proposal = await parsePatchProposalFile(patchFile, context.rootDir);
      const inspection = await inspectPatch(context, proposal, {
        scope: options.scope
      });

      writeOutput(
        io,
        {
          proposal,
          inspection
        },
        formatPatchInspectResult({
          proposal,
          inspection
        })
      );
    });

  patch
    .command("apply")
    .argument("<patchFile>", "Patch proposal file")
    .option("--dry-run", "Run git apply --check without modifying files", false)
    .option("--allow-write", "Allow patch application", false)
    .option("--allow-dirty-worktree", "Allow patch apply when the git worktree is dirty", false)
    .option("--confirm-apply", "Confirm patch application", false)
    .option("--scope <scope>", "Restrict patch application to a repository scope")
    .option("--typecheck", "Run typecheck after apply", false)
    .option("--lint", "Run lint after apply", false)
    .option("--test", "Run tests after apply", false)
    .action(
      async (
        patchFile: string,
        options: {
          allowWrite: boolean;
          allowDirtyWorktree: boolean;
          confirmApply: boolean;
          dryRun: boolean;
          lint: boolean;
          scope?: string;
          test: boolean;
          typecheck: boolean;
        }
      ) => {
        const context = await resolveCommandContext({
          allowWrite: options.allowWrite,
          dryRunWhenDisallowed: false,
          forceExecute: true,
          writeMode: "require-flag"
        });
        const proposal = await parsePatchProposalFile(patchFile, context.rootDir);
        const result = await applyPatchProposal(context, proposal, {
          dryRun: options.dryRun,
          allowWrite: options.allowWrite,
          allowDirtyWorktree: options.allowDirtyWorktree,
          confirmApply: options.confirmApply,
          scope: options.scope,
          runValidation: {
            typecheck: options.typecheck,
            lint: options.lint,
            test: options.test
          }
        });

        writeOutput(io, result, formatPatchApplyResult(result));
      }
    );

  patch
    .command("propose")
    .option("--goal <goal>", "Patch goal")
    .option("--scope <scope>", "Optional scope")
    .option("--error-log <text>", "Inline error log")
    .option("--error-log-file <path>", "Repository-local error log file")
    .requiredOption("--worker <workerId>", "Worker id")
    .option("--require-profile", "Require a persisted worker profile", false)
    .option("--output <path>", "Optional patch proposal output path")
    .option("--allow-write-output", "Allow writing the output file", false)
    .option("--summary", "Print a summary instead of the full workflow output", false)
    .option("--full", "Force the full workflow output", false)
    .option("--max-bytes <bytes>", "Limit preview fields in summary output", Number)
    .action(
      async (options: {
        allowWriteOutput: boolean;
        errorLog?: string;
        errorLogFile?: string;
        full: boolean;
        goal?: string;
        maxBytes?: number;
        output?: string;
        requireProfile: boolean;
        scope?: string;
        summary: boolean;
        worker: string;
      }) => {
        const context = await resolveExecutionContext();
        const errorLog = options.errorLog ??
          (options.errorLogFile
            ? await readRepositoryFile(options.errorLogFile, context.rootDir)
            : undefined);
        const result = await runPatchProposalWorkflow({
          context,
          goal: options.goal,
          scope: options.scope,
          errorLog,
          workerId: options.worker,
          requireProfile: options.requireProfile
        });
        const serialized = JSON.stringify(result, null, 2);

        if (options.output && options.allowWriteOutput) {
          await writeRepositoryFile(
            options.output,
            serialized,
            context,
            true
          );
        }

        const formatted = formatPatchProposalWorkflowOutput(
          result,
          resolveWorkflowOutputOptions(options)
        );

        if (isHumanOutput(io) && !options.summary && !options.full) {
          writeText(io, formatPatchProposalSummaryText(formatted as Record<string, unknown>));
          return;
        }

        writeJson(io, formatted);
      }
    );
};
