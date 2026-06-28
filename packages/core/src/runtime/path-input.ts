import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export interface NormalizeFileSystemPathOptions {
  cwd?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/iu;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/u;
const HOME_PATH_PATTERN = /^~(?=$|[\\/])/u;

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

export const looksLikeWindowsAbsolutePath = (value: string): boolean =>
  WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value);

export const looksLikeFileSystemPath = (value: string): boolean => {
  const sanitized = stripWrappingQuotes(value);

  return (
    sanitized.startsWith("file://") ||
    HOME_PATH_PATTERN.test(sanitized) ||
    sanitized.startsWith("./") ||
    sanitized.startsWith(".\\") ||
    sanitized.startsWith("../") ||
    sanitized.startsWith("..\\") ||
    sanitized.startsWith("/") ||
    sanitized.startsWith("\\") ||
    sanitized.includes("/") ||
    sanitized.includes("\\") ||
    looksLikeWindowsAbsolutePath(sanitized)
  );
};

export const normalizeFileSystemPath = (
  value: string,
  options: NormalizeFileSystemPathOptions = {}
): string => {
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();
  let sanitized = stripWrappingQuotes(value);

  if (sanitized.startsWith("file://")) {
    sanitized = fileURLToPath(sanitized);
  }

  if (HOME_PATH_PATTERN.test(sanitized)) {
    const relativeToHome = sanitized.slice(1).replace(/^[\\/]+/u, "");
    sanitized =
      platform === "win32"
        ? win32.join(homeDir, relativeToHome.replaceAll("/", "\\"))
        : posix.join(homeDir.replaceAll("\\", "/"), relativeToHome.replaceAll("\\", "/"));
  }

  if (platform === "win32") {
    const normalizedCwd = win32.normalize(cwd);
    const normalizedInput = sanitized.replaceAll("/", "\\");

    return looksLikeWindowsAbsolutePath(normalizedInput) || normalizedInput.startsWith("\\")
      ? win32.normalize(normalizedInput)
      : win32.resolve(normalizedCwd, normalizedInput);
  }

  if (looksLikeWindowsAbsolutePath(sanitized)) {
    return posix.normalize(sanitized.replaceAll("\\", "/"));
  }

  const normalizedCwd = cwd.replaceAll("\\", "/");
  const normalizedInput = sanitized.replaceAll("\\", "/");

  return posix.isAbsolute(normalizedInput)
    ? posix.normalize(normalizedInput)
    : posix.resolve(normalizedCwd, normalizedInput);
};

export const normalizeCommandInput = (
  value: string,
  options: NormalizeFileSystemPathOptions = {}
): string => {
  const sanitized = stripWrappingQuotes(value);

  if (!looksLikeFileSystemPath(sanitized)) {
    return sanitized;
  }

  return normalizeFileSystemPath(sanitized, options);
};
