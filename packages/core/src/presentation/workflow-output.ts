import type { TaskSession } from "../schemas/task-session.schema.js";
import type {
  ValidationCheck,
  ValidationReport
} from "../schemas/validation.schema.js";
import { summarizeValidationOutcome } from "../validation/validation-report.js";

export type OutputDetailLevel = "summary" | "full";

export interface ArtifactRef {
  name: string;
  path: string;
}

const TRUNCATION_SUFFIX = "\n...[truncated]";

const unique = (values: string[]): string[] => Array.from(new Set(values));

const previewValidationLines = (
  check: ValidationCheck,
  maxBytes: number
): string[] => {
  const preferred = check.diagnosticSummary?.previewLines ?? [];

  if (preferred.length > 0) {
    return preferred.map((line) => truncateText(line, maxBytes));
  }

  const raw = [check.stderr, check.stdout]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .map((line) => truncateText(line, maxBytes));
};

export const truncateText = (value: string, maxBytes = 4_000): string => {
  if (maxBytes <= 0 || Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }

  const budget = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_SUFFIX, "utf8"));
  let end = value.length;

  while (end > 0) {
    const candidate = value.slice(0, end);

    if (Buffer.byteLength(candidate, "utf8") <= budget) {
      return `${candidate}${TRUNCATION_SUFFIX}`;
    }

    end -= 1;
  }

  return TRUNCATION_SUFFIX.trimStart();
};

export const buildArtifactRefs = (
  artifacts: Record<string, string>
): ArtifactRef[] =>
  Object.entries(artifacts).map(([name, path]) => ({
    name,
    path
  }));

export const createTaskSessionSummary = (
  session: TaskSession,
  includeArtifactRefs = true
) => ({
  taskId: session.taskId,
  goal: session.goal,
  scope: session.scope,
  workerId: session.workerId,
  status: session.status,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  warningCount: session.warnings.length,
  errorCount: session.errors.length,
  steps: session.steps.map((step) => ({
    id: step.id,
    name: step.name,
    status: step.status,
    artifactPath: step.artifactPath
  })),
  ...(includeArtifactRefs
    ? {
        artifactRefs: buildArtifactRefs(session.artifacts)
      }
    : {})
});

export const createTaskSessionReportSummary = (
  session: TaskSession,
  report: string,
  maxBytes = 4_000,
  includeArtifactRefs = true
) => ({
  ...createTaskSessionSummary(session, includeArtifactRefs),
  reportPath: session.artifacts["report.md"],
  reportPreview: truncateText(report, maxBytes)
});

export const summarizeValidationReport = (
  report: ValidationReport,
  maxBytes = 2_000
) => {
  const outcome = summarizeValidationOutcome(report);

  return {
    ok: report.ok,
    confidence: outcome.confidence,
    summary: outcome.summary,
    warnings: report.warnings,
    failedChecks: outcome.failedChecks,
    notConfiguredChecks: outcome.notConfiguredChecks,
    dryRunChecks: outcome.dryRunChecks,
    checks: report.checks.map((check) => ({
      name: check.name,
      command: check.command,
      status: check.status,
      scriptName: check.scriptName,
      resolutionSource: check.resolutionSource,
      exitCode: check.exitCode,
      timedOut: check.timedOut ?? false,
      affectedPaths: unique(check.diagnosticSummary?.affectedPaths ?? []),
      previewLines: previewValidationLines(check, maxBytes),
      stdoutTruncated: check.stdoutTruncated ?? false,
      stderrTruncated: check.stderrTruncated ?? false
    }))
  };
};
