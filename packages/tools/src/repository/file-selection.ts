import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import {
  AgentError,
  type RepositoryFileContent,
  type RepositoryFileSummary,
  type SelectionReason
} from "@agent-orchestrator/core";

import { rankRepositoryContextFiles } from "./context-ranker.js";

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
  errorLog?: string;
  files?: string[];
  ignoredPaths?: string[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
  rootDir: string;
  scope?: string;
  strictFiles?: boolean;
}

interface ResolvedRepositoryScope {
  effectiveScope?: string;
  warnings: string[];
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

export const resolveRepositoryPath = (
  rootDir: string,
  path: string
): string => ensureInsideRoot(rootDir, path);

export const isRepositoryPathInsideScope = (
  rootDir: string,
  path: string,
  scope?: string
): boolean => {
  if (!scope) {
    return true;
  }

  const scopedRoot = resolveRepositoryScope(rootDir, scope);
  const normalized = ensureInsideRoot(rootDir, path);
  const relativePath = relative(scopedRoot, normalized);

  return !(
    relativePath.startsWith("..") ||
    relativePath.includes(`..\\`) ||
    relativePath.includes("../")
  );
};

const ensureInsideScope = (
  rootDir: string,
  path: string,
  scope?: string
): string => {
  const normalized = ensureInsideRoot(rootDir, path);

  if (!scope || isRepositoryPathInsideScope(rootDir, normalized, scope)) {
    return normalized;
  }

  throw new AgentError(
    "REPOSITORY_SCOPE_BLOCKED",
    `Path ${path} is outside the allowed repository scope ${scope}.`,
    {
      path: toRelativePath(rootDir, normalized),
      scope
    }
  );
};

const resolveSelectionScope = async (
  rootDir: string,
  scope: string | undefined,
  hasExplicitFiles: boolean
): Promise<ResolvedRepositoryScope> => {
  if (!scope) {
    return {
      warnings: []
    };
  }

  const resolvedScope = resolveRepositoryScope(rootDir, scope);

  if (!hasExplicitFiles) {
    return {
      effectiveScope: scope,
      warnings: []
    };
  }

  try {
    await stat(resolvedScope);
    return {
      effectiveScope: scope,
      warnings: []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/ENOENT/u.test(message)) {
      throw error;
    }

    return {
      warnings: [
        `Ignoring scope "${scope}" because it does not resolve to an existing repository path. Use files for explicit file review and scope only for repository paths.`
      ]
    };
  }
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
  errorLog,
  ignoredPaths = [...DEFAULT_IGNORED_PATHS],
  maxFileBytes = 20_000,
  maxTotalBytes = 120_000,
  strictFiles = false
}: SelectRepositoryFilesOptions): Promise<{
  effectiveScope?: string;
  files: RepositoryFileSummary[];
  selectionReasons: SelectionReason[];
  selectedFiles: RepositoryFileContent[];
  strictFiles: boolean;
  warnings: string[];
}> => {
  const scopeResolution = await resolveSelectionScope(
    rootDir,
    scope,
    (files?.length ?? 0) > 0
  );
  const effectiveScope = scopeResolution.effectiveScope;
  const scopedRoot = resolveRepositoryScope(rootDir, effectiveScope);
  const warnings: string[] = [...scopeResolution.warnings];
  const summaries: RepositoryFileSummary[] = [];
  const selectedFiles: RepositoryFileContent[] = [];
  let selectionReasons: SelectionReason[] = [];

  const selectedSet = new Set(
    (files ?? []).map((file) =>
      toRelativePath(rootDir, ensureInsideScope(rootDir, file, effectiveScope))
    )
  );
  const candidateFiles: RepositoryFileContent[] = [];

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
      const candidateSelection =
        selectedSet.size === 0 && isReadableTextFile(fullPath);

      summaries.push({
        path: relativePath,
        sizeBytes: fileStat.size,
        selected: false,
        ...(candidateSelection ? {} : { reason: "Not selected for context." })
      });

      if (!candidateSelection) {
        continue;
      }

      const fileContent = await readScopedRepositoryFile(
        rootDir,
        fullPath,
        maxFileBytes
      );
      candidateFiles.push(fileContent);
    }
  };

  if (selectedSet.size > 0) {
    let totalBytes = 0;
    for (const path of selectedSet) {
      const fullPath = ensureInsideScope(rootDir, path, effectiveScope);
      const fileStat = await stat(fullPath);
      summaries.push({
        path,
        sizeBytes: fileStat.size,
        selected: true
      });
      const fileContent = await readScopedRepositoryFile(rootDir, fullPath, maxFileBytes);
      const nextBytes = totalBytes + Buffer.byteLength(fileContent.content, "utf8");

      if (nextBytes > maxTotalBytes) {
        if (strictFiles) {
          throw new AgentError(
            "REPOSITORY_CONTEXT_LIMIT_EXCEEDED",
            `Explicit file ${path} would exceed maxTotalBytes in strict file mode.`,
            {
              maxTotalBytes,
              path,
              strictFiles: true
            }
          );
        }
        warnings.push(
          `Explicit file ${path} exceeded maxTotalBytes but was still included because it was explicitly requested.`
        );
      }

      selectedFiles.push(fileContent);
      selectionReasons.push({
        path,
        reason: "Explicitly requested for repository context.",
        score: 100
      });
      totalBytes = nextBytes;
    }
  } else {
    await walk(scopedRoot);
    const ranked = rankRepositoryContextFiles({
      files: candidateFiles,
      scope: effectiveScope,
      errorLog
    });
    let totalBytes = 0;

    for (const file of ranked.rankedFiles) {
      if (totalBytes >= maxTotalBytes) {
        warnings.push("Maximum repository context size reached.");
        continue;
      }

      const nextBytes = totalBytes + Buffer.byteLength(file.content, "utf8");
      if (nextBytes > maxTotalBytes) {
        warnings.push(`Skipping ${file.path} because maxTotalBytes was reached.`);
        continue;
      }

      selectedFiles.push(file);
      totalBytes = nextBytes;
    }

    const selectedPaths = new Set(selectedFiles.map((file) => file.path));
    selectionReasons = ranked.selectionReasons.filter((entry) =>
      selectedPaths.has(entry.path)
    );
    for (const summary of summaries) {
      if (selectedPaths.has(summary.path)) {
        summary.selected = true;
        summary.reason =
          selectionReasons.find((entry) => entry.path === summary.path)?.reason;
      }
    }
  }

  return {
    effectiveScope,
    files: summaries,
    selectionReasons,
    selectedFiles,
    strictFiles,
    warnings
  };
};
