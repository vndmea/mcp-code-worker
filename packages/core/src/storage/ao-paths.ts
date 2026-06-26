import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

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

export const getAoHomeDir = (
  env: NodeJS.ProcessEnv = process.env
): string =>
  resolve(env.AO_HOME_DIR ?? process.env.AO_HOME_DIR ?? join(homedir(), ".ao"));

export const getAoWorkspaceId = (rootDir: string): string => {
  const normalizedRootDir = resolve(rootDir);
  const slug = getWorkspaceSlug(normalizedRootDir);
  const digest = createHash("sha256")
    .update(normalizedRootDir)
    .digest("hex")
    .slice(0, 10);

  return `${slug}-${digest}`;
};

export const getAoWorkspaceDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => join(getAoHomeDir(env), "workspaces", getAoWorkspaceId(rootDir));

export const getAoWorkspaceFilePathFromStorageDir = (
  aoStorageDir: string,
  fileName: string
): string => join(resolve(aoStorageDir), fileName);

export const getAoWorkspaceFilePath = (
  rootDir: string,
  fileName: string,
  env: NodeJS.ProcessEnv = process.env
): string =>
  getAoWorkspaceFilePathFromStorageDir(getAoWorkspaceDir(rootDir, env), fileName);

export const getAoWorkspaceRunsDirFromStorageDir = (
  aoStorageDir: string
): string => join(resolve(aoStorageDir), "runs");

export const getAoWorkspaceRunsDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getAoWorkspaceRunsDirFromStorageDir(getAoWorkspaceDir(rootDir, env));

export const getAoWorkspaceAuditDirFromStorageDir = (
  aoStorageDir: string
): string => join(resolve(aoStorageDir), "audit");

export const getAoWorkspaceAuditDir = (
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env
): string => getAoWorkspaceAuditDirFromStorageDir(getAoWorkspaceDir(rootDir, env));
