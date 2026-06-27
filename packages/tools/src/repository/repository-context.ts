import type {
  ExecutionContext,
  RepositoryContextPack
} from "@agent-orchestrator/core";

import { readGitDiff, type ReadGitDiffOptions } from "./git-diff.js";
import { readPackageMetadata } from "./package-metadata.js";
import { selectRepositoryFiles } from "./file-selection.js";

export interface BuildRepositoryContextOptions {
  diffBase?: string;
  diffHead?: string;
  errorLog?: string;
  files?: string[];
  ignoredPaths?: string[];
  includeDiff?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  rootDir: string;
  scope?: string;
  strictFiles?: boolean;
}

export const buildRepositoryContextPack = async (
  context: ExecutionContext,
  options: BuildRepositoryContextOptions
): Promise<RepositoryContextPack> => {
  const fileSelection = await selectRepositoryFiles({
    rootDir: options.rootDir,
    scope: options.scope,
    errorLog: options.errorLog,
    files: options.files,
    ignoredPaths: options.ignoredPaths ?? context.contextBudget.ignoredPaths,
    maxFileBytes: options.maxFileBytes ?? context.contextBudget.maxFileBytes,
    maxTotalBytes: options.maxTotalBytes ?? context.contextBudget.maxTotalBytes,
    strictFiles: options.strictFiles ?? context.contextBudget.strictFiles
  });
  const packageMetadata = await readPackageMetadata(
    options.rootDir,
    fileSelection.effectiveScope
  );
  const gitDiff = options.includeDiff
    ? await readGitDiff(context, {
        base: options.diffBase,
        head: options.diffHead,
        maxBytes: options.maxTotalBytes ?? context.contextBudget.maxTotalBytes
      } satisfies ReadGitDiffOptions)
    : undefined;

  return {
    rootDir: options.rootDir,
    scope: fileSelection.effectiveScope,
    files: fileSelection.files,
    selectedFiles: fileSelection.selectedFiles,
    selectionReasons: fileSelection.selectionReasons,
    requestedFiles: options.files ?? [],
    skippedFiles: fileSelection.skippedFiles,
    coverageGapDetected: fileSelection.skippedFiles.length > 0,
    strictFiles: fileSelection.strictFiles,
    packageMetadata,
    gitDiff,
    warnings: fileSelection.warnings,
    generatedAt: new Date().toISOString()
  };
};
