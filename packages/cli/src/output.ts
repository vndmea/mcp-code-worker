import { homedir } from "node:os";
import { relative, resolve } from "node:path";

import type { WorkflowOutputOptions } from "@mcp-code-worker/graph";
import { Chalk } from "chalk";

import type { CliIo } from "./index.js";

const humanChalk = new Chalk({ level: 1 });

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

const styleHumanLine = (line: string): string => {
  if (line.startsWith("blocking:")) {
    return humanChalk.red(`✖ ${line}`);
  }

  if (line.startsWith("warnings:")) {
    return humanChalk.yellow(`⚠ ${line}`);
  }

  if (line.startsWith("next:")) {
    return humanChalk.cyan(`→ ${line}`);
  }

  if (line.startsWith("cw doctor:")) {
    return humanChalk.bold(
      line.includes(": ready")
        ? humanChalk.green(`✔ ${line}`)
        : line.includes(": degraded")
          ? humanChalk.yellow(`⚠ ${line}`)
          : line.includes(": blocked")
            ? humanChalk.red(`✖ ${line}`)
            : humanChalk.cyan(`• ${line}`)
    );
  }

  if (line.startsWith("cw setup:")) {
    return humanChalk.bold(
      line.includes(": ready")
        ? humanChalk.green(`✔ ${line}`)
        : line.includes(": degraded")
          ? humanChalk.yellow(`⚠ ${line}`)
          : line.includes(": misconfigured")
            ? humanChalk.red(`✖ ${line}`)
            : humanChalk.cyan(`• ${line}`)
    );
  }

  if (line.startsWith("cw init:")) {
    return humanChalk.bold(
      line.includes(": applied")
        ? humanChalk.green(`✔ ${line}`)
        : line.includes(": preview") || line.includes(": cancelled")
          ? humanChalk.yellow(`⚠ ${line}`)
          : humanChalk.cyan(`• ${line}`)
    );
  }

  if (line.startsWith("task ")) {
    return humanChalk.bold(
      line.includes(": completed")
        ? humanChalk.green(`✔ ${line}`)
        : line.includes(": needs-review") || line.includes(": needs-input")
          ? humanChalk.yellow(`⚠ ${line}`)
          : line.includes(": blocked") || line.includes(": failed")
            ? humanChalk.red(`✖ ${line}`)
            : humanChalk.cyan(`• ${line}`)
    );
  }

  if (line === "audit events") {
    return humanChalk.bold.cyan(line);
  }

  if (line === "none") {
    return humanChalk.dim(line);
  }

  return line;
};

const styleHumanLines = (
  lines: Array<string | null | undefined> | string
): Array<string | null | undefined> | string => {
  if (!Array.isArray(lines)) {
    return styleHumanLine(lines);
  }

  return lines.map((line) =>
    typeof line === "string" && line.length > 0 ? styleHumanLine(line) : line
  );
};

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

export const writeHumanText = (
  io: CliIo,
  lines: Array<string | null | undefined> | string
): void => {
  writeText(io, styleHumanLines(lines));
};

export const writeOutput = (
  io: CliIo,
  value: unknown,
  human: Array<string | null | undefined> | string
): void => {
  if (isHumanOutput(io)) {
    writeHumanText(io, human);
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
