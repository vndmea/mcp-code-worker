import {
  AgentError,
  type ExecutionContext,
  type GitDiffSummary
} from "@agent-orchestrator/core";

import { runSafeCommand } from "../shell/safe-command.js";

export interface ReadGitDiffOptions {
  base?: string;
  head?: string;
}

const SAFE_GIT_REF = /^[A-Za-z0-9._~/\-]+$/u;

const sanitizeRef = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  if (!SAFE_GIT_REF.test(value)) {
    throw new AgentError("GIT_REF_BLOCKED", `Unsafe git ref: ${value}`, {
      ref: value
    });
  }

  return value;
};

const collectChangedFiles = (diffText: string): string[] => {
  const changedFiles = new Set<string>();

  diffText.split(/\r?\n/u).forEach((line) => {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      const path = parts[2]?.replace(/^a\//u, "");
      if (path) {
        changedFiles.add(path);
      }
    }
  });

  return Array.from(changedFiles);
};

export const readGitDiff = async (
  context: ExecutionContext,
  options: ReadGitDiffOptions = {}
): Promise<GitDiffSummary> => {
  const base = sanitizeRef(options.base);
  const head = sanitizeRef(options.head);
  const range = base && head ? `${base}...${head}` : undefined;
  const command = range ? `git diff --no-ext-diff ${range}` : "git diff --no-ext-diff";
  const result = await runSafeCommand(command, context, {
    commandKind: "read-only"
  });
  const diffText = result.stdout;

  return {
    base,
    head,
    changedFiles: collectChangedFiles(diffText),
    diffText,
    truncated: Boolean(result.stdoutTruncated)
  };
};
