import { z } from "zod";

export const ValidationCheckDiagnosticSchema = z.object({
  affectedPaths: z.array(z.string()),
  previewLines: z.array(z.string())
});

export const ValidationCheckSchema = z.object({
  name: z.string(),
  command: z.string(),
  status: z.enum(["success", "failure", "skipped", "dry-run"]),
  exitCode: z.number().nullable().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  timedOut: z.boolean().optional(),
  stdoutTruncated: z.boolean().optional(),
  stderrTruncated: z.boolean().optional(),
  diagnosticSummary: ValidationCheckDiagnosticSchema.optional()
});

export const ValidationReportSchema = z.object({
  checks: z.array(ValidationCheckSchema),
  ok: z.boolean(),
  warnings: z.array(z.string())
});

export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
