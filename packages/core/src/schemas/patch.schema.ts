import { z } from "zod";

import { ValidationReportSchema } from "./validation.schema.js";

export const PatchFileChangeSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["add", "modify", "delete"]),
  summary: z.string(),
  riskLevel: z.enum(["low", "medium", "high"]),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional()
});

export const PatchProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  rationale: z.array(z.string()),
  unifiedDiff: z.string().min(1),
  files: z.array(PatchFileChangeSchema),
  risks: z.array(z.string()),
  validationPlan: z.array(z.string()),
  generatedAt: z.string().datetime(),
  source: z.object({
    workflow: z.string(),
    taskId: z.string().optional(),
    workerId: z.string().optional()
  })
});

export const PatchInspectionSchema = z.object({
  ok: z.boolean(),
  files: z.array(PatchFileChangeSchema),
  blockedReasons: z.array(z.string()),
  warnings: z.array(z.string()),
  stats: z.object({
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative()
  })
});

export const PatchApplyResultSchema = z.object({
  mode: z.enum(["dry-run", "execute", "blocked"]),
  applied: z.boolean(),
  patchId: z.string().optional(),
  touchedFiles: z.array(z.string()),
  inspection: PatchInspectionSchema,
  validationReport: ValidationReportSchema.optional(),
  warnings: z.array(z.string()),
  errors: z.array(z.string())
});

export type PatchFileChange = z.infer<typeof PatchFileChangeSchema>;
export type PatchProposal = z.infer<typeof PatchProposalSchema>;
export type PatchInspection = z.infer<typeof PatchInspectionSchema>;
export type PatchApplyResult = z.infer<typeof PatchApplyResultSchema>;
