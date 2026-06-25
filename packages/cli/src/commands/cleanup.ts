import { readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import type { Command } from "commander";

import {
  loadAoConfig,
  resolveExecutionContext,
  writeAuditEvent
} from "@agent-orchestrator/core";

import type { CliIo } from "../index.js";

interface CleanupResult {
  deleted: string[];
  mode: "execute" | "dry-run";
  target: "audit" | "runs";
  warnings: string[];
  wouldDelete: string[];
}

interface CleanupTargetValidation {
  deletePath?: string;
  warning?: string;
}

const PROTECTED_AO_FILES = new Set([
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
  rootDir: string,
  target: CleanupResult["target"],
  candidatePath: string
): Promise<CleanupTargetValidation> => {
  const allowedDirectory = resolve(rootDir, ".ao", target);
  const normalizedCandidatePath = resolve(candidatePath);
  const resolvedCandidatePath = await realpath(candidatePath).catch(
    () => normalizedCandidatePath
  );
  const candidateName = basename(normalizedCandidatePath);

  if (PROTECTED_AO_FILES.has(candidateName)) {
    return {
      warning: `Skipped protected .ao file ${candidateName}.`
    };
  }

  if (
    !isPathInsideDirectory(allowedDirectory, normalizedCandidatePath) ||
    !isPathInsideDirectory(allowedDirectory, resolvedCandidatePath)
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
  olderThanDays: number
): Promise<{ targets: string[]; warnings: string[] }> => {
  const targetDir = join(rootDir, ".ao", target);
  const cutoff = Date.now() - olderThanDays * 86_400_000;

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const selected: string[] = [];
    const warnings: string[] = [];

    for (const entry of entries) {
      const path = join(targetDir, entry.name);
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

      const validated = await resolveCleanupTargetPath(rootDir, target, path);
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
        const config = await loadAoConfig(context.rootDir);
        const retentionDays = Number.parseInt(
          options.olderThanDays ?? `${config.config.sessions.retentionDays}`,
          10
        );
        const cleanupTargets = await listCleanupTargets(
          context.rootDir,
          target,
          Number.isNaN(retentionDays) ? config.config.sessions.retentionDays : retentionDays
        );
        const deletion = await deleteTargets(cleanupTargets.targets, options.allowWrite);
        const result: CleanupResult = {
          mode: options.allowWrite ? "execute" : "dry-run",
          target,
          deleted: deletion.deleted.map((path) => relative(context.rootDir, path).replaceAll("\\", "/")),
          wouldDelete: deletion.wouldDelete.map((path) => relative(context.rootDir, path).replaceAll("\\", "/")),
          warnings: cleanupTargets.warnings
        };

        if (options.allowWrite) {
          await writeAuditEvent(
            context,
            {
              actor: "cli",
              action: `cleanup-${target}`,
              mode: "execute",
              inputSummary: `ao cleanup ${target}`,
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

        io.write(JSON.stringify(result, null, 2));
      }
    );
};

export const registerCleanupCommand = (program: Command, io: CliIo): void => {
  const cleanup = program.command("cleanup").description("Remove aged local .ao run and audit artifacts.");

  registerCleanupSubcommand(cleanup, io, "runs");
  registerCleanupSubcommand(cleanup, io, "audit");
};
