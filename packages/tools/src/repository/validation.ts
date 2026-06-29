import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExecutionContext,
  ValidationCheck,
  ValidationReport
} from "@mcp-code-worker/core";
import {
  createExecutionContextFromEnv,
  loadCwConfig,
  resolveValidationScript
} from "@mcp-code-worker/core";

import { runSafeCommand } from "../shell/safe-command.js";
import { resolveRepositoryScope } from "./file-selection.js";

const VALIDATION_COMMAND_TIMEOUT_MS = 180_000;

export interface RunRepositoryValidationOptions {
  all?: boolean;
  build?: boolean;
  lint?: boolean;
  scope?: string;
  stopOnFailure?: boolean;
  test?: boolean;
  typecheck?: boolean;
}

type RequestedValidationCheck = "build" | "typecheck" | "lint" | "test";

interface ValidationScriptExecutionPlan {
  executionContext: ExecutionContext;
  resolution: ReturnType<typeof resolveValidationScript>;
  scopeSource: "scoped" | "workspace-root";
}

const appendNotRunChecks = (
  checks: ValidationCheck[],
  context: ExecutionContext,
  rootConfig: Awaited<ReturnType<typeof loadCwConfig>>,
  rootScripts: Record<string, string>,
  scopedContext: ExecutionContext,
  scopedScripts: Record<string, string>,
  scopedValidationRequested: boolean,
  checkNames: RequestedValidationCheck[]
): void => {
  for (const checkName of checkNames) {
    const plan = resolveValidationExecutionPlan({
      checkName,
      context,
      rootConfig,
      rootScripts,
      scopedContext,
      scopedScripts,
      scopedValidationRequested
    });

    checks.push({
      name: checkName,
      command: plan.resolution.command ?? `pnpm run ${checkName}`,
      status: "not-run",
      scriptName: plan.resolution.scriptName,
      resolutionSource: plan.resolution.source
    });
  }
};

const readScripts = async (rootDir: string): Promise<Record<string, string>> => {
  try {
    const contents = await readFile(join(rootDir, "package.json"), "utf8");
    const parsed = JSON.parse(contents) as { scripts?: Record<string, string> };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
};

const resolveValidationExecutionPlan = (input: {
  checkName: RequestedValidationCheck;
  context: ExecutionContext;
  rootConfig: Awaited<ReturnType<typeof loadCwConfig>>;
  rootScripts: Record<string, string>;
  scopedContext: ExecutionContext;
  scopedScripts: Record<string, string>;
  scopedValidationRequested: boolean;
}): ValidationScriptExecutionPlan => {
  const scopedResolution = resolveValidationScript(
    input.scopedScripts,
    input.rootConfig.config.validation,
    input.checkName
  );

  if (
    !input.scopedValidationRequested ||
    scopedResolution.source !== "missing" ||
    input.scopedContext.rootDir === input.context.rootDir
  ) {
    return {
      executionContext: input.scopedContext,
      resolution: scopedResolution,
      scopeSource: "scoped"
    };
  }

  const rootResolution = resolveValidationScript(
    input.rootScripts,
    input.rootConfig.config.validation,
    input.checkName
  );

  if (rootResolution.source !== "missing" && rootResolution.command) {
    return {
      executionContext: input.context,
      resolution: rootResolution,
      scopeSource: "workspace-root"
    };
  }

  return {
    executionContext: input.scopedContext,
    resolution: scopedResolution,
    scopeSource: "scoped"
  };
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
  const scopedScripts = await readScripts(scopedContext.rootDir);
  const rootScripts =
    scopedContext.rootDir === context.rootDir
      ? scopedScripts
      : await readScripts(context.rootDir);
  const rootConfig = await loadCwConfig(context.rootDir);
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];
  const runAll = options.all ?? false;
  const scopedValidationRequested = scopedContext.rootDir !== context.rootDir;
  const requestedChecks = [
    { enabled: runAll || options.build, name: "build" as const },
    { enabled: runAll || options.typecheck, name: "typecheck" as const },
    { enabled: runAll || options.lint, name: "lint" as const },
    { enabled: runAll || options.test, name: "test" as const }
  ];

  for (const check of requestedChecks) {
    if (!check.enabled) {
      continue;
    }

    const plan = resolveValidationExecutionPlan({
      checkName: check.name,
      context,
      rootConfig,
      rootScripts,
      scopedContext,
      scopedScripts,
      scopedValidationRequested
    });
    const resolution = plan.resolution;

    if (resolution.source === "missing" || !resolution.command) {
      checks.push(buildUnconfiguredCheck(check.name, resolution.triedScriptNames));
      warnings.push(
        `Validation for ${check.name} is not configured in ${scopedContext.rootDir}.`
      );

      if (options.stopOnFailure) {
        const remainingChecks = requestedChecks
          .filter((candidate) => candidate.enabled)
          .slice(requestedChecks.indexOf(check) + 1)
          .map((candidate) => candidate.name);

        if (remainingChecks.length > 0) {
          appendNotRunChecks(
            checks,
            context,
            rootConfig,
            rootScripts,
            scopedContext,
            scopedScripts,
            scopedValidationRequested,
            remainingChecks
          );
          warnings.push(
            `Validation stopped after ${check.name} was not configured. Skipped: ${remainingChecks.join(", ")}.`
          );
        }
        break;
      }
      continue;
    }

    const result = await runSafeCommand(resolution.command, plan.executionContext, {
      maxOutputBytes: 120_000,
      timeoutMs: VALIDATION_COMMAND_TIMEOUT_MS
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

    if (plan.scopeSource === "workspace-root") {
      warnings.push(
        `Validation for ${check.name} fell back to workspace-root script ${resolution.scriptName} because no scoped script was available in ${scopedContext.rootDir}.`
      );
    }

    if (resolution.source === "configured") {
      warnings.push(
        `Validation for ${check.name} is using an explicit script mapping to ${resolution.scriptName}.`
      );
    }

    if (resolution.source === "auto-discovered") {
      warnings.push(
        `Validation for ${check.name} auto-discovered script ${resolution.scriptName}. Consider persisting a mapping in the cw workspace config.`
      );
    }

    if (options.stopOnFailure && result.code !== 0) {
      const remainingChecks = requestedChecks
        .filter((candidate) => candidate.enabled)
        .slice(requestedChecks.indexOf(check) + 1)
        .map((candidate) => candidate.name);

      if (remainingChecks.length > 0) {
        appendNotRunChecks(
          checks,
          context,
          rootConfig,
          rootScripts,
          scopedContext,
          scopedScripts,
          scopedValidationRequested,
          remainingChecks
        );
        warnings.push(
          `Validation stopped after ${check.name} failed. Skipped: ${remainingChecks.join(", ")}.`
        );
      }
      break;
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
