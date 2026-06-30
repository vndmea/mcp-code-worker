import { z } from "zod";

export const CwModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  clientCommand: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
});

export const CwWorkerModelConfigSchema = CwModelConfigSchema.extend({
  workerId: z.string().min(1)
});

export const CwSafetyConfigSchema = z.object({
  dryRun: z.boolean().default(true),
  allowWrite: z.boolean().default(false),
  allowedCommands: z.array(z.string()).default(["git", "node", "pnpm"])
});

export const CwContextConfigSchema = z.object({
  strictFiles: z.boolean().default(false),
  ignoredPaths: z.array(z.string()).default([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next"
  ])
});

export const CwSessionConfigSchema = z.object({
  retentionDays: z.number().int().positive().default(3),
  maxStoredSessions: z.number().int().positive().default(5)
});

const ValidationScriptMappingSchema = z.object({
  build: z.array(z.string().min(1)).default([]),
  typecheck: z.array(z.string().min(1)).default([]),
  lint: z.array(z.string().min(1)).default([]),
  test: z.array(z.string().min(1)).default([])
});

export const CwValidationConfigSchema = z.object({
  autoDiscover: z.boolean().default(true),
  scripts: ValidationScriptMappingSchema.default({
    build: [],
    typecheck: [],
    lint: [],
    test: []
  })
});

export const CwConfigSchema = z.object({
  version: z.literal(1),
  workers: z.array(CwWorkerModelConfigSchema).optional(),
  safety: CwSafetyConfigSchema.default({
    dryRun: true,
    allowWrite: false,
    allowedCommands: ["git", "node", "pnpm"]
  }),
  context: CwContextConfigSchema.default({
    strictFiles: false,
    ignoredPaths: [
      "node_modules",
      ".git",
      "dist",
      "build",
      "coverage",
      ".turbo",
      ".next"
    ]
  }),
  sessions: CwSessionConfigSchema.default({
    retentionDays: 3,
    maxStoredSessions: 5
  }),
  validation: CwValidationConfigSchema.default({
    autoDiscover: true,
    scripts: {
      build: [],
      typecheck: [],
      lint: [],
      test: []
    }
  })
});

export type CwModelConfig = z.infer<typeof CwModelConfigSchema>;
export type CwWorkerModelConfig = z.infer<typeof CwWorkerModelConfigSchema>;
export type CwConfig = z.infer<typeof CwConfigSchema>;
