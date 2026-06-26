import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface FileWriteEvaluation {
  allowed: boolean;
  mode: "execute" | "dry-run" | "blocked";
  path: string;
  normalizedPath: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
}

export interface EvaluateFileWritePathOptions {
  allowWrite: boolean;
  additionalRootDirs?: string[];
  dryRun: boolean;
  explicitAllowWrite?: boolean;
  rootDir: string;
}

const SECRET_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/iu,
  /^id_rsa$/iu,
  /^id_ed25519$/iu,
  /\.pem$/iu,
  /\.key$/iu,
  /\.p12$/iu,
  /\.pfx$/iu
];

const resolveRealOrSelf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const isWithinRoot = (rootDir: string, candidate: string): boolean => {
  const relativePath = relative(rootDir, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))
  );
};

const resolveNearestExistingAncestor = (path: string): string => {
  let currentPath = path;

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return currentPath;
    }

    currentPath = parentPath;
  }

  return currentPath;
};

const block = (
  path: string,
  normalizedPath: string,
  reason: string,
  riskLevel: FileWriteEvaluation["riskLevel"] = "high"
): FileWriteEvaluation => ({
  allowed: false,
  mode: "blocked",
  path,
  normalizedPath,
  reason,
  riskLevel
});

export const evaluateFileWritePath = (
  path: string,
  options: EvaluateFileWritePathOptions
): FileWriteEvaluation => {
  const rootDir = resolve(options.rootDir);
  const allowedRoots = [
    rootDir,
    ...(options.additionalRootDirs ?? []).map((value) => resolve(value))
  ];
  const normalizedPath = isAbsolute(path)
    ? resolve(path)
    : resolve(rootDir, path);
  const matchedRootDir = allowedRoots.find((candidateRoot) =>
    isWithinRoot(candidateRoot, normalizedPath)
  );

  if (!matchedRootDir) {
    return block(path, normalizedPath, "Write path escapes the allowed roots.");
  }

  const existingAllowedRoot = resolveNearestExistingAncestor(matchedRootDir);
  const rootRealPath = resolveRealOrSelf(existingAllowedRoot);
  const relativePath = relative(matchedRootDir, normalizedPath);
  const topLevelSegment = relativePath.split(/[\\/]/u).filter(Boolean)[0];
  const fileName = basename(normalizedPath).toLowerCase();

  if (topLevelSegment === ".git") {
    return block(path, normalizedPath, "Writes to .git internals are blocked.");
  }

  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    return block(
      path,
      normalizedPath,
      "Writes to environment or secret-like files are blocked."
    );
  }

  const nearestExistingAncestor = resolveNearestExistingAncestor(normalizedPath);
  const ancestorRealPath = resolveRealOrSelf(nearestExistingAncestor);

  if (!isWithinRoot(rootRealPath, ancestorRealPath)) {
    return block(
      path,
      normalizedPath,
      "Write path escapes an allowed root via a symlink."
    );
  }

  if (existsSync(normalizedPath)) {
    try {
      const stat = lstatSync(normalizedPath);
      if (stat.isSymbolicLink()) {
        const targetRealPath = resolveRealOrSelf(normalizedPath);
        if (!isWithinRoot(rootRealPath, targetRealPath)) {
          return block(
          path,
          normalizedPath,
          "Write path resolves outside an allowed root via a symlink."
        );
      }
      }
    } catch {
      return block(
        path,
        normalizedPath,
        "Unable to safely inspect the target path."
      );
    }
  }

  if (options.allowWrite || options.explicitAllowWrite) {
    return {
      allowed: true,
      mode: "execute",
      path,
      normalizedPath,
      reason: "Write is allowed by policy.",
      riskLevel: "low"
    };
  }

  return {
    allowed: true,
    mode: "dry-run",
    path,
    normalizedPath,
    reason: "Write blocked by default; returning dry-run result instead.",
    riskLevel: "low"
  };
};
