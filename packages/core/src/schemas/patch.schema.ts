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

export const DirtyWorktreeSchema = z.object({
  ignoredFiles: z.array(z.string()),
  stagedFiles: z.array(z.string()),
  modifiedFiles: z.array(z.string()),
  untrackedFiles: z.array(z.string()),
  rawStatus: z.array(z.string())
});

export const PatchRollbackActionSchema = z.object({
  command: z.literal("git"),
  args: z.array(z.string()).min(1)
});

export const PatchRecoverySchema = z.object({
  validationFailed: z.boolean(),
  touchedFiles: z.array(z.string()),
  failedChecks: z.array(z.string()),
  preApplyDirty: z.boolean(),
  dirtyFilesBeforeApply: z.array(z.string()),
  safeToRunRollbackCommands: z.boolean(),
  rollbackActions: z.array(PatchRollbackActionSchema).optional(),
  rollbackCommands: z.array(z.string()),
  manualRecoveryGuide: z.array(z.string())
});

export const PatchApplyResultSchema = z.object({
  mode: z.enum(["dry-run", "execute", "blocked"]),
  applied: z.boolean(),
  patchId: z.string().optional(),
  touchedFiles: z.array(z.string()),
  inspection: PatchInspectionSchema,
  dirtyWorktree: DirtyWorktreeSchema.optional(),
  validationReport: ValidationReportSchema.optional(),
  recovery: PatchRecoverySchema.optional(),
  warnings: z.array(z.string()),
  errors: z.array(z.string())
});

export type PatchFileChange = z.infer<typeof PatchFileChangeSchema>;
export type PatchProposal = z.infer<typeof PatchProposalSchema>;
export type PatchInspection = z.infer<typeof PatchInspectionSchema>;
export type DirtyWorktree = z.infer<typeof DirtyWorktreeSchema>;
export type PatchRollbackAction = z.infer<typeof PatchRollbackActionSchema>;
export type PatchRecovery = z.infer<typeof PatchRecoverySchema>;
export type PatchApplyResult = z.infer<typeof PatchApplyResultSchema>;
