import { readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import type { Command } from "commander";

import {
  getCwWorkspaceAuditDir,
  getCwWorkspaceAuditDirFromStorageDir,
  getCwWorkspaceRunsDir,
  getCwWorkspaceRunsDirFromStorageDir,
  loadCwConfig,
  resolveExecutionContext,
  writeAuditEvent
} from "@mcp-code-worker/core";

import type { CliIo } from "../index.js";
import { formatDisplayPath, writeOutput } from "../output.js";

interface CleanupResult {
  deleted: string[];
  mode: "execute" | "dry-run";
  target: "audit" | "runs";
  warnings: string[];
  wouldDelete: string[];
}

const formatCleanupResult = (result: CleanupResult): string[] => {
  const lines: string[] = [
    result.mode === "execute"
      ? `Cleaned ${result.target} artifacts.`
      : `Dry-run: ${result.target} cleanup preview.`
  ];

  if (result.deleted.length > 0) {
    lines.push(`deleted: ${result.deleted.join(", ")}`);
  }

  if (result.wouldDelete.length > 0) {
    lines.push(`would delete: ${result.wouldDelete.join(", ")}`);
  }

  if (result.warnings.length > 0) {
    lines.push(`warnings: ${result.warnings.join(" | ")}`);
  }

  return lines;
};

interface CleanupTargetValidation {
  deletePath?: string;
  warning?: string;
}

const PROTECTED_CW_FILES = new Set([
  "config.json",
  "worker-profiles.json",
  "workers.json"
]);

const isPathInsideDirectory = (directory: string, candidate: string): boolean => {
  const relativePath = relative(directory, candidate);
  return relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !relativePath.includes(`..\\`) &&
    !relativePath.includes("../");
};

export const resolveCleanupTargetPath = async (
  targetDirectory: string,
  candidatePath: string
): Promise<CleanupTargetValidation> => {
  const normalizedAllowedDirectory = resolve(targetDirectory);
  const resolvedAllowedDirectory = await realpath(targetDirectory).catch(
    () => normalizedAllowedDirectory
  );
  const normalizedCandidatePath = resolve(candidatePath);
  const resolvedCandidatePath = await realpath(candidatePath).catch(
    () => normalizedCandidatePath
  );
  const candidateName = basename(normalizedCandidatePath);

  if (PROTECTED_CW_FILES.has(candidateName)) {
    return {
      warning: `Skipped protected cw workspace file ${candidateName}.`
    };
  }

  if (
    !isPathInsideDirectory(normalizedAllowedDirectory, normalizedCandidatePath) ||
    !isPathInsideDirectory(resolvedAllowedDirectory, resolvedCandidatePath)
  ) {
    return {
      warning: `Skipped unsafe cleanup target ${normalizedCandidatePath}.`
    };
  }

  return {
    deletePath: normalizedCandidatePath
  };
};

const listCleanupTargets = async (
  rootDir: string,
  target: CleanupResult["target"],
  olderThanDays: number,
  cwStorageDir?: string
): Promise<{ targets: string[]; warnings: string[] }> => {
  const targetDir =
    target === "runs"
      ? cwStorageDir
        ? getCwWorkspaceRunsDirFromStorageDir(cwStorageDir)
        : getCwWorkspaceRunsDir(rootDir)
      : cwStorageDir
        ? getCwWorkspaceAuditDirFromStorageDir(cwStorageDir)
        : getCwWorkspaceAuditDir(rootDir);
  const cutoff = Date.now() - olderThanDays * 86_400_000;

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const selected: string[] = [];
    const warnings: string[] = [];

    for (const entry of entries) {
      const path = resolve(targetDir, entry.name);
      const details = await stat(path);
      const age = details.mtime.getTime();

      if (age > cutoff) {
        continue;
      }

      if (target === "audit" && !entry.name.endsWith(".jsonl")) {
        continue;
      }

      if (target === "runs" && !entry.isDirectory()) {
        continue;
      }

      const validated = await resolveCleanupTargetPath(targetDir, path);
      if (validated.deletePath) {
        selected.push(validated.deletePath);
        continue;
      }

      if (validated.warning) {
        warnings.push(validated.warning);
      }
    }

    return {
      targets: selected,
      warnings
    };
  } catch {
    return {
      targets: [],
      warnings: []
    };
  }
};

const deleteTargets = async (
  targets: string[],
  allowWrite: boolean
): Promise<{ deleted: string[]; wouldDelete: string[] }> => {
  if (!allowWrite) {
    return {
      deleted: [],
      wouldDelete: targets
    };
  }

  for (const target of targets) {
    await rm(target, { recursive: true, force: true });
  }

  return {
    deleted: targets,
    wouldDelete: []
  };
};

const registerCleanupSubcommand = (
  cleanup: Command,
  io: CliIo,
  target: CleanupResult["target"]
) => {
  cleanup
    .command(target)
    .option("--older-than-days <days>", "Retention threshold in days")
    .option("--allow-write", "Delete matching artifacts", false)
    .action(
      async (options: {
        allowWrite: boolean;
        olderThanDays?: string;
      }) => {
        const context = await resolveExecutionContext({
          cliOverrides: {
            allowWrite: options.allowWrite,
            dryRun: !options.allowWrite
          }
        });
        const config = await loadCwConfig(context.rootDir);
        const retentionDays = Number.parseInt(
          options.olderThanDays ?? `${config.config.sessions.retentionDays}`,
          10
        );
        const cleanupTargets = await listCleanupTargets(
          context.rootDir,
          target,
          Number.isNaN(retentionDays) ? config.config.sessions.retentionDays : retentionDays,
          context.cwStorageDir
        );
        const deletion = await deleteTargets(cleanupTargets.targets, options.allowWrite);
        const result: CleanupResult = {
          mode: options.allowWrite ? "execute" : "dry-run",
          target,
          deleted: deletion.deleted.map((path) => formatDisplayPath(context.rootDir, path)),
          wouldDelete: deletion.wouldDelete.map((path) => formatDisplayPath(context.rootDir, path)),
          warnings: cleanupTargets.warnings
        };

        if (options.allowWrite) {
          await writeAuditEvent(
            context,
            {
              actor: "cli",
              action: `cleanup-${target}`,
              mode: "execute",
              inputSummary: `cw cleanup ${target}`,
              outputSummary: `Deleted ${result.deleted.length} ${target} artifact(s).`,
              warnings: [],
              errors: [],
              metadata: {
                target,
                deleted: result.deleted
              }
            },
            true
          );
        }

        writeOutput(io, result, formatCleanupResult(result));
      }
    );
};

export const registerCleanupCommand = (program: Command, io: CliIo): void => {
  const cleanup = program
    .command("cleanup")
    .description("Remove aged user-scoped cw run and audit artifacts.");

  registerCleanupSubcommand(cleanup, io, "runs");
  registerCleanupSubcommand(cleanup, io, "audit");
};
