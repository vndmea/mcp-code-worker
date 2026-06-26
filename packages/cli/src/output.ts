import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import type { WorkflowOutputOptions } from "@agent-orchestrator/graph";

import type { CliIo } from "./index.js";

export interface CliDetailOptions {
  artifactRefs?: boolean;
  full?: boolean;
  maxBytes?: number;
  summary?: boolean;
}

export const resolveWorkflowOutputOptions = (
  options: CliDetailOptions
): WorkflowOutputOptions => ({
  detailLevel: options.summary && !options.full ? "summary" : "full",
  includeArtifactRefs: options.artifactRefs ?? true,
  maxBytes: options.maxBytes
});

export const writeJson = (io: CliIo, value: unknown): void => {
  io.write(JSON.stringify(value, null, 2));
};

export const isHumanOutput = (io: CliIo): boolean => io.outputMode === "human";

export const writeText = (
  io: CliIo,
  lines: Array<string | null | undefined> | string
): void => {
  let text: string;

  if (Array.isArray(lines)) {
    const compacted: string[] = [];

    for (const line of lines) {
      if (typeof line === "string" && line.length > 0) {
        compacted.push(line);
      }
    }

    text = compacted.join("\n");
  } else {
    text = lines;
  }

  io.write(text);
};

export const writeOutput = (
  io: CliIo,
  value: unknown,
  human: Array<string | null | undefined> | string
): void => {
  if (isHumanOutput(io)) {
    writeText(io, human);
    return;
  }

  writeJson(io, value);
};

export const formatList = (
  values: string[],
  emptyMessage: string
): string => (values.length > 0 ? values.join(", ") : emptyMessage);

export const formatDisplayPath = (
  rootDir: string,
  targetPath: string
): string => {
  const normalizedRootDir = resolve(rootDir);
  const normalizedTargetPath = resolve(targetPath);
  const relativeToRoot = relative(normalizedRootDir, normalizedTargetPath);

  if (
    relativeToRoot === "" ||
    (!relativeToRoot.startsWith("..") &&
      !relativeToRoot.includes(`..\\`) &&
      !relativeToRoot.includes("../"))
  ) {
    return relativeToRoot.replaceAll("\\", "/") || ".";
  }

  const homeDir = resolve(homedir());
  const relativeToHome = relative(homeDir, normalizedTargetPath);

  if (
    relativeToHome === "" ||
    (!relativeToHome.startsWith("..") &&
      !relativeToHome.includes(`..\\`) &&
      !relativeToHome.includes("../"))
  ) {
    const homeRelativePath = relativeToHome.replaceAll("\\", "/");
    return homeRelativePath.length > 0 ? `~/${homeRelativePath}` : "~";
  }

  return normalizedTargetPath.replaceAll("\\", "/");
};
