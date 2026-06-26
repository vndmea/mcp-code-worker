import type { ValidationReport } from "../schemas/validation.schema.js";

export interface ValidationOutcomeSummary {
  confidence: "advisory" | "not-verified" | "verified";
  dryRunChecks: string[];
  executedChecks: number;
  failedChecks: string[];
  notConfiguredChecks: string[];
  passedChecks: string[];
  skippedChecks: string[];
  summary: string;
  totalChecks: number;
}

const list = (values: string[]): string => values.join(", ");

export const summarizeValidationOutcome = (
  report: ValidationReport | undefined
): ValidationOutcomeSummary => {
  if (!report) {
    return {
      confidence: "not-verified",
      dryRunChecks: [],
      executedChecks: 0,
      failedChecks: [],
      notConfiguredChecks: [],
      passedChecks: [],
      skippedChecks: [],
      summary: "No validation report was recorded.",
      totalChecks: 0
    };
  }

  const failedChecks = report.checks
    .filter((check) => check.status === "failure")
    .map((check) => check.name);
  const notConfiguredChecks = report.checks
    .filter((check) => check.status === "not-configured")
    .map((check) => check.name);
  const dryRunChecks = report.checks
    .filter((check) => check.status === "dry-run")
    .map((check) => check.name);
  const skippedChecks = report.checks
    .filter((check) => check.status === "skipped" || check.status === "not-run")
    .map((check) => check.name);
  const passedChecks = report.checks
    .filter((check) => check.status === "success")
    .map((check) => check.name);
  const executedChecks = passedChecks.length + failedChecks.length;

  if (report.checks.length === 0) {
    return {
      confidence: "not-verified",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary:
        "No validation checks were requested or executed. This does not prove the result is correct.",
      totalChecks: 0
    };
  }

  if (failedChecks.length > 0) {
    return {
      confidence: "not-verified",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary: `Validation found issues in: ${list(failedChecks)}.`,
      totalChecks: report.checks.length
    };
  }

  if (notConfiguredChecks.length > 0) {
    return {
      confidence: "not-verified",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary:
        `Validation could not run because these checks are not configured: ${list(notConfiguredChecks)}.`,
      totalChecks: report.checks.length
    };
  }

  if (dryRunChecks.length === report.checks.length) {
    return {
      confidence: "advisory",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary:
        `Validation ran only in dry-run mode for: ${list(dryRunChecks)}. This is advisory and does not prove the result is correct.`,
      totalChecks: report.checks.length
    };
  }

  if (dryRunChecks.length > 0) {
    return {
      confidence: "advisory",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary:
        `Validation passed on executed checks, but these checks were only planned in dry-run mode: ${list(dryRunChecks)}.`,
      totalChecks: report.checks.length
    };
  }

  if (skippedChecks.length > 0) {
    return {
      confidence: "advisory",
      dryRunChecks,
      executedChecks,
      failedChecks,
      notConfiguredChecks,
      passedChecks,
      skippedChecks,
      summary:
        `Validation passed on executed checks, but some checks were skipped or not run: ${list(skippedChecks)}.`,
      totalChecks: report.checks.length
    };
  }

  return {
    confidence: "verified",
    dryRunChecks,
    executedChecks,
    failedChecks,
    notConfiguredChecks,
    passedChecks,
    skippedChecks,
    summary: `Validation passed across ${executedChecks} executed check(s).`,
    totalChecks: report.checks.length
  };
};
