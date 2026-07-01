import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

import { normalizeFileSystemPath } from "../runtime/path-input.js";

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);

const getWorkspaceSlug = (rootDir: string): string => {
  const candidate = slugify(basename(rootDir));
  return candidate.length > 0 ? candidate : "workspace";
};

const canonicalizeWorkspaceRootDir = (rootDir: string): string => {
  const normalizedRootDir = resolve(rootDir);

  try {
    return realpathSync.native(normalizedRootDir);
  } catch {
    return normalizedRootDir;
  }
};

export const getCwHomeDir = (): string =>
  normalizeFileSystemPath(
    process.env.CW_STORAGE_DIR?.trim() || join(homedir(), ".code-worker")
  );

export const getCwWorkspaceId = (rootDir: string): string => {
  const canonicalRootDir = canonicalizeWorkspaceRootDir(rootDir);
  const slug = getWorkspaceSlug(canonicalRootDir);
  const digest = createHash("sha256")
    .update(canonicalRootDir)
    .digest("hex")
    .slice(0, 10);

  return `${slug}-${digest}`;
};

export const getCwWorkspaceDir = (
  rootDir: string
): string => join(getCwHomeDir(), getCwWorkspaceId(rootDir));

export const getCwWorkspaceFilePathFromStorageDir = (
  cwStorageDir: string,
  fileName: string
): string => join(resolve(cwStorageDir), fileName);

export const getCwWorkspaceFilePath = (
  rootDir: string,
  fileName: string
): string =>
  getCwWorkspaceFilePathFromStorageDir(getCwWorkspaceDir(rootDir), fileName);

export const getCwWorkspaceDatabasePathFromStorageDir = (
  cwStorageDir: string
): string => getCwWorkspaceFilePathFromStorageDir(cwStorageDir, "data.db");

export const getCwWorkspaceDatabasePath = (
  rootDir: string
): string => getCwWorkspaceDatabasePathFromStorageDir(getCwWorkspaceDir(rootDir));

export const getCwWorkspaceRunsDirFromStorageDir = (
  cwStorageDir: string
): string => join(resolve(cwStorageDir), "runs");

export const getCwWorkspaceRunsDir = (
  rootDir: string
): string => getCwWorkspaceRunsDirFromStorageDir(getCwWorkspaceDir(rootDir));

export const getCwWorkspaceAuditDirFromStorageDir = (
  cwStorageDir: string
): string => join(resolve(cwStorageDir), "audit");

export const getCwWorkspaceAuditDir = (
  rootDir: string
): string => getCwWorkspaceAuditDirFromStorageDir(getCwWorkspaceDir(rootDir));
