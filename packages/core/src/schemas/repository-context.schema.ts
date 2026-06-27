import { z } from "zod";

export const RepositoryFileSummarySchema = z.object({
  path: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  selected: z.boolean(),
  reason: z.string().optional()
});

export const RepositoryFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  truncated: z.boolean(),
  sizeBytes: z.number().int().nonnegative()
});

export const PackageMetadataSchema = z.object({
  packageManager: z.string().optional(),
  packageJsonPath: z.string().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
  workspaces: z.array(z.string()).default([])
});

export const GitDiffSummarySchema = z.object({
  base: z.string().optional(),
  head: z.string().optional(),
  changedFiles: z.array(z.string()),
  diffText: z.string(),
  truncated: z.boolean()
});

export const SelectionReasonSchema = z.object({
  path: z.string(),
  reason: z.string(),
  score: z.number()
});

export const RepositoryContextPackSchema = z.object({
  rootDir: z.string(),
  scope: z.string().optional(),
  files: z.array(RepositoryFileSummarySchema),
  selectedFiles: z.array(RepositoryFileContentSchema),
  selectionReasons: z.array(SelectionReasonSchema).default([]),
  requestedFiles: z.array(z.string()).default([]),
  strictFiles: z.boolean().default(false),
  packageMetadata: PackageMetadataSchema.optional(),
  gitDiff: GitDiffSummarySchema.optional(),
  warnings: z.array(z.string()),
  generatedAt: z.string().datetime()
});

export type RepositoryContextPack = z.infer<typeof RepositoryContextPackSchema>;
export type RepositoryFileContent = z.infer<typeof RepositoryFileContentSchema>;
export type RepositoryFileSummary = z.infer<typeof RepositoryFileSummarySchema>;
export type PackageMetadata = z.infer<typeof PackageMetadataSchema>;
export type GitDiffSummary = z.infer<typeof GitDiffSummarySchema>;
export type SelectionReason = z.infer<typeof SelectionReasonSchema>;
