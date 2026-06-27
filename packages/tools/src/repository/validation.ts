import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExecutionContext,
  ValidationCheck,
  ValidationReport
} from "@agent-orchestrator/core";
import {
  createExecutionContextFromEnv,
  loadAoConfig,
  resolveValidationScript
} from "@agent-orchestrator/core";

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

const buildUnconfiguredCheck = (
  name: string,
  triedScriptNames: string[]
): ValidationCheck => ({
  name,
  command: `pnpm run ${name}`,
  status: "not-configured",
  resolutionSource: "missing",
  diagnosticSummary: {
    affectedPaths: [],
    previewLines: [
      `No script mapping was found for ${name}. Tried: ${triedScriptNames.join(", ")}`
    ]
  }
});

const diagnosticPathPattern =
  /(?:^|\s)([A-Za-z0-9._/-]+\.(?:[A-Za-z0-9]{1,8}))(?:[:(]\d+)?/gu;

const buildDiagnosticSummary = (
  stdout: string,
  stderr: string
): ValidationCheck["diagnosticSummary"] | undefined => {
  const output = `${stderr}\n${stdout}`.trim();

  if (!output) {
    return undefined;
  }

  const affectedPaths = Array.from(output.matchAll(diagnosticPathPattern))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const previewLines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .map((line) => line.slice(0, 240));

  return {
    affectedPaths: Array.from(new Set(affectedPaths)),
    previewLines
  };
};

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
  const rootConfig = await loadAoConfig(context.rootDir);
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];
  const requestedChecks = [
    { enabled: options.typecheck, name: "typecheck" as const },
    { enabled: options.lint, name: "lint" as const },
    { enabled: options.test, name: "test" as const }
  ];

  for (const check of requestedChecks) {
    if (!check.enabled) {
      continue;
    }

    const resolution = resolveValidationScript(
      scripts,
      rootConfig.config.validation,
      check.name
    );

    if (resolution.source === "missing" || !resolution.command) {
      checks.push(buildUnconfiguredCheck(check.name, resolution.triedScriptNames));
      warnings.push(
        `Validation for ${check.name} is not configured in ${scopedContext.rootDir}.`
      );
      continue;
    }

    const result = await runSafeCommand(resolution.command, scopedContext, {
      maxOutputBytes: 120_000,
      timeoutMs: 120_000
    });

    checks.push({
      name: check.name,
      command: resolution.command,
      scriptName: resolution.scriptName,
      resolutionSource: resolution.source,
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
      stderrTruncated: result.stderrTruncated,
      diagnosticSummary: buildDiagnosticSummary(result.stdout, result.stderr)
    });

    if (resolution.source === "configured") {
      warnings.push(
        `Validation for ${check.name} is using an explicit script mapping to ${resolution.scriptName}.`
      );
    }

    if (resolution.source === "auto-discovered") {
      warnings.push(
        `Validation for ${check.name} auto-discovered script ${resolution.scriptName}. Consider persisting a mapping in the ao workspace config.`
      );
    }
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
