import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import {
  AgentError,
  type RepositoryFileContent,
  type RepositoryFileSummary
} from "@agent-orchestrator/core";

const DEFAULT_IGNORED_PATHS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next"
] as const;

const SECRET_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/u,
  /^id_rsa$/u,
  /^id_ed25519$/u,
  /\.pem$/u,
  /\.key$/u,
  /\.p12$/u,
  /\.pfx$/u
];

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

export interface SelectRepositoryFilesOptions {
  files?: string[];
  ignoredPaths?: string[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
  rootDir: string;
  scope?: string;
}

const isSecretLikeFile = (path: string): boolean =>
  SECRET_FILE_PATTERNS.some((pattern) => pattern.test(basename(path).toLowerCase()));

const ensureInsideRoot = (rootDir: string, path: string): string => {
  const normalized = resolve(rootDir, path);
  const relativePath = relative(rootDir, normalized);

  if (
    relativePath.startsWith("..") ||
    relativePath.includes(`..\\`) ||
    relativePath.includes("../")
  ) {
    throw new AgentError(
      "REPOSITORY_PATH_BLOCKED",
      `Path ${path} escapes the repository root.`,
      {
        path
      }
    );
  }

  return normalized;
};

const normalizeIgnoredPath = (path: string): string =>
  path.replaceAll("\\", "/").replace(/^\.\/+/u, "").replace(/\/+$/u, "");

const shouldIgnoreEntry = (
  path: string,
  ignoredPaths: string[]
): boolean => {
  const normalizedPath = normalizeIgnoredPath(path);
  const segments = normalizedPath.split("/");

  return ignoredPaths.some((ignoredPath) => {
    const normalizedIgnoredPath = normalizeIgnoredPath(ignoredPath);
    if (!normalizedIgnoredPath) {
      return false;
    }

    if (normalizedPath === normalizedIgnoredPath) {
      return true;
    }

    if (normalizedPath.startsWith(`${normalizedIgnoredPath}/`)) {
      return true;
    }

    return !normalizedIgnoredPath.includes("/") &&
      segments.includes(normalizedIgnoredPath);
  });
};

const isReadableTextFile = (path: string): boolean => {
  if (TEXT_EXTENSIONS.has(extname(path))) {
    return true;
  }

  return basename(path) === "package.json" || basename(path) === "tsconfig.json";
};

const toRelativePath = (rootDir: string, path: string): string =>
  relative(rootDir, path).replaceAll("\\", "/");

export const resolveRepositoryScope = (
  rootDir: string,
  scope?: string
): string => {
  if (!scope) {
    return rootDir;
  }

  return ensureInsideRoot(rootDir, scope);
};

export const readScopedRepositoryFile = async (
  rootDir: string,
  path: string,
  maxFileBytes = 20_000
): Promise<RepositoryFileContent> => {
  const normalized = ensureInsideRoot(rootDir, path);

  if (isSecretLikeFile(normalized)) {
    throw new AgentError(
      "REPOSITORY_SECRET_FILE_BLOCKED",
      `Refusing to read secret-like file ${path}.`,
      { path }
    );
  }

  const fileStat = await stat(normalized);
  const content = await readFile(normalized, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > maxFileBytes;
  const encoded = Buffer.from(content, "utf8");

  return {
    path: toRelativePath(rootDir, normalized),
    content: truncated
      ? encoded.subarray(0, maxFileBytes).toString("utf8")
      : content,
    truncated,
    sizeBytes: fileStat.size
  };
};

export const selectRepositoryFiles = async ({
  rootDir,
  scope,
  files,
  ignoredPaths = [...DEFAULT_IGNORED_PATHS],
  maxFileBytes = 20_000,
  maxTotalBytes = 120_000
}: SelectRepositoryFilesOptions): Promise<{
  files: RepositoryFileSummary[];
  selectedFiles: RepositoryFileContent[];
  warnings: string[];
}> => {
  const scopedRoot = resolveRepositoryScope(rootDir, scope);
  const warnings: string[] = [];
  const summaries: RepositoryFileSummary[] = [];
  const selectedFiles: RepositoryFileContent[] = [];
  let totalBytes = 0;

  const selectedSet = new Set(
    (files ?? []).map((file) => toRelativePath(rootDir, ensureInsideRoot(rootDir, file)))
  );

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      const relativePath = toRelativePath(rootDir, fullPath);

      if (shouldIgnoreEntry(relativePath, ignoredPaths) || isSecretLikeFile(fullPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      const fileStat = await stat(fullPath);
      const explicitlySelected =
        selectedSet.size > 0 ? selectedSet.has(relativePath) : false;
      const candidateSelection =
        explicitlySelected ||
        (selectedSet.size === 0 && isReadableTextFile(fullPath));

      summaries.push({
        path: relativePath,
        sizeBytes: fileStat.size,
        selected: candidateSelection,
        ...(candidateSelection ? {} : { reason: "Not selected for context." })
      });

      if (!candidateSelection) {
        continue;
      }

      if (totalBytes >= maxTotalBytes) {
        warnings.push("Maximum repository context size reached.");
        continue;
      }

      const fileContent = await readScopedRepositoryFile(
        rootDir,
        fullPath,
        maxFileBytes
      );
      const nextBytes = totalBytes + Buffer.byteLength(fileContent.content, "utf8");

      if (nextBytes > maxTotalBytes) {
        warnings.push(`Skipping ${relativePath} because maxTotalBytes was reached.`);
        continue;
      }

      selectedFiles.push(fileContent);
      totalBytes = nextBytes;
    }
  };

  if (selectedSet.size > 0) {
    for (const path of selectedSet) {
      const fullPath = ensureInsideRoot(rootDir, path);
      const fileStat = await stat(fullPath);
      summaries.push({
        path,
        sizeBytes: fileStat.size,
        selected: true
      });
      const fileContent = await readScopedRepositoryFile(rootDir, fullPath, maxFileBytes);
      const nextBytes = totalBytes + Buffer.byteLength(fileContent.content, "utf8");

      if (nextBytes > maxTotalBytes) {
        warnings.push(`Skipping ${path} because maxTotalBytes was reached.`);
        continue;
      }

      selectedFiles.push(fileContent);
      totalBytes = nextBytes;
    }
  } else {
    await walk(scopedRoot);
  }

  return {
    files: summaries,
    selectedFiles,
    warnings
  };
};
