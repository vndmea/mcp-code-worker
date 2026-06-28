import { createHash } from "node:crypto";
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

export const getCwHomeDir = (
  env: NodeJS.ProcessEnv = process.env
): string =>
  normalizeFileSystemPath(
    env.CW_HOME_DIR ?? process.env.CW_HOME_DIR ?? join(homedir(), ".cw")
  );

export const getCwWorkspaceId = (rootDir: string): string => {
  const normalizedRootDir = resolve(rootDir);
  const slug = getWorkspaceSlug(normalizedRootDir);
  const digest = createHash("sha256")
    .update(normalizedRootDir)
    .digest("hex")
    .slice(0, 10);

  return `${slug}-${digest}`;
};

export const getCwWorkspaceDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => join(getCwHomeDir(env), "workspaces", getCwWorkspaceId(rootDir));

export const getCwWorkspaceFilePathFromStorageDir = (
  cwStorageDir: string,
  fileName: string
): string => join(resolve(cwStorageDir), fileName);

export const getCwWorkspaceFilePath = (
  rootDir: string,
  fileName: string,
  env: NodeJS.ProcessEnv = process.env
): string =>
  getCwWorkspaceFilePathFromStorageDir(getCwWorkspaceDir(rootDir, env), fileName);

export const getCwWorkspaceRunsDirFromStorageDir = (
  cwStorageDir: string
): string => join(resolve(cwStorageDir), "runs");

export const getCwWorkspaceRunsDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getCwWorkspaceRunsDirFromStorageDir(getCwWorkspaceDir(rootDir, env));

export const getCwWorkspaceAuditDirFromStorageDir = (
  cwStorageDir: string
): string => join(resolve(cwStorageDir), "audit");

export const getCwWorkspaceAuditDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getCwWorkspaceAuditDirFromStorageDir(getCwWorkspaceDir(rootDir, env));
