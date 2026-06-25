import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExecutionContext,
  ValidationCheck,
  ValidationReport
} from "@agent-orchestrator/core";
import { createExecutionContextFromEnv } from "@agent-orchestrator/core";

import { runSafeCommand } from "../shell/safe-command.js";
import { resolveRepositoryScope } from "./file-selection.js";

export interface RunRepositoryValidationOptions {
  lint?: boolean;
  scope?: string;
  test?: boolean;
  typecheck?: boolean;
}

const readScripts = async (rootDir: string): Promise<Record<string, string>> => {
  try {
    const contents = await readFile(join(rootDir, "package.json"), "utf8");
    const parsed = JSON.parse(contents) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
};

const buildSkippedCheck = (name: string, command: string): ValidationCheck => ({
  name,
  command,
  status: "skipped"
});

const createScopedContext = (
  context: ExecutionContext,
  scope?: string
): ExecutionContext =>
  scope
    ? createExecutionContextFromEnv(process.env, {
        rootDir: resolveRepositoryScope(context.rootDir, scope),
        allowWrite: context.allowWrite,
        allowedCommands: context.allowedCommands,
        contextBudget: context.contextBudget,
        dryRun: context.dryRun,
        leaderModel: context.leaderModel,
        logLevel: context.logLevel,
        serverName: context.serverName,
        serverVersion: context.serverVersion,
        workerModel: context.workerModel
      })
    : context;

export const runRepositoryValidation = async (
  context: ExecutionContext,
  options: RunRepositoryValidationOptions
): Promise<ValidationReport> => {
  const scopedContext = createScopedContext(context, options.scope);
  const scripts = await readScripts(scopedContext.rootDir);
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];
  const requestedChecks = [
    { enabled: options.typecheck, name: "typecheck", command: "pnpm typecheck" },
    { enabled: options.lint, name: "lint", command: "pnpm lint" },
    { enabled: options.test, name: "test", command: "pnpm test" }
  ];

  for (const check of requestedChecks) {
    if (!check.enabled) {
      continue;
    }

    if (!scripts[check.name]) {
      checks.push(buildSkippedCheck(check.name, check.command));
      warnings.push(`Skipped ${check.name} because the script is missing.`);
      continue;
    }

    const result = await runSafeCommand(check.command, scopedContext, {
      maxOutputBytes: 120_000,
      timeoutMs: 120_000
    });

    checks.push({
      name: check.name,
      command: check.command,
      status:
        result.mode === "dry-run"
          ? "dry-run"
          : result.code === 0
            ? "success"
            : "failure",
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    });
  }

  return {
    checks,
    ok: checks.every(
      (check) =>
        check.status === "success" ||
        check.status === "skipped" ||
        check.status === "dry-run"
    ),
    warnings
  };
};
