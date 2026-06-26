import { resolve } from "node:path";

export interface WorkspaceBindingSummary {
  callerWorkingDirectory: string;
  matchesCallerWorkingDirectory: boolean;
  rootDir: string;
  switchedFrom?: string;
  warning?: string;
}

export const buildWorkspaceBindingSummary = (
  rootDir: string,
  callerWorkingDirectory = process.cwd()
): WorkspaceBindingSummary => {
  const normalizedRootDir = resolve(rootDir);
  const normalizedCallerWorkingDirectory = resolve(callerWorkingDirectory);
  const matchesCallerWorkingDirectory =
    normalizedRootDir === normalizedCallerWorkingDirectory;

  return {
    rootDir: normalizedRootDir,
    callerWorkingDirectory: normalizedCallerWorkingDirectory,
    matchesCallerWorkingDirectory,
    ...(matchesCallerWorkingDirectory
      ? {}
      : {
          switchedFrom: normalizedCallerWorkingDirectory,
          warning:
            `ao is currently bound to ${normalizedRootDir} instead of the caller working directory ${normalizedCallerWorkingDirectory}.`
        })
  };
};
