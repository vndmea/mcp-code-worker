import { z } from "zod";

export const AoModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
});

export const AoSafetyConfigSchema = z.object({
  dryRun: z.boolean().default(true),
  allowWrite: z.boolean().default(false),
  allowedCommands: z.array(z.string()).default(["git", "node", "pnpm"])
});

export const AoContextConfigSchema = z.object({
  maxFileBytes: z.number().int().positive().default(20_000),
  maxTotalBytes: z.number().int().positive().default(120_000),
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

export const AoSessionConfigSchema = z.object({
  retentionDays: z.number().int().positive().default(30),
  maxStoredSessions: z.number().int().positive().default(100)
});

const ValidationScriptMappingSchema = z.object({
  typecheck: z.array(z.string().min(1)).default([]),
  lint: z.array(z.string().min(1)).default([]),
  test: z.array(z.string().min(1)).default([])
});

export const AoValidationConfigSchema = z.object({
  autoDiscover: z.boolean().default(true),
  scripts: ValidationScriptMappingSchema.default({
    typecheck: [],
    lint: [],
    test: []
  })
});

export const AoConfigSchema = z.object({
  version: z.literal(1),
  leaderModel: AoModelConfigSchema.optional(),
  workerModel: AoModelConfigSchema.optional(),
  safety: AoSafetyConfigSchema.default({
    dryRun: true,
    allowWrite: false,
    allowedCommands: ["git", "node", "pnpm"]
  }),
  context: AoContextConfigSchema.default({
    maxFileBytes: 20_000,
    maxTotalBytes: 120_000,
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
  sessions: AoSessionConfigSchema.default({
    retentionDays: 30,
    maxStoredSessions: 100
  }),
  validation: AoValidationConfigSchema.default({
    autoDiscover: true,
    scripts: {
      typecheck: [],
      lint: [],
      test: []
    }
  })
});

export type AoModelConfig = z.infer<typeof AoModelConfigSchema>;
export type AoConfig = z.infer<typeof AoConfigSchema>;
