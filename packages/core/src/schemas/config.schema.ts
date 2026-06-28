import { z } from "zod";

export const CwModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
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
  retentionDays: z.number().int().positive().default(30),
  maxStoredSessions: z.number().int().positive().default(100)
});

const ValidationScriptMappingSchema = z.object({
  typecheck: z.array(z.string().min(1)).default([]),
  lint: z.array(z.string().min(1)).default([]),
  test: z.array(z.string().min(1)).default([])
});

export const CwValidationConfigSchema = z.object({
  autoDiscover: z.boolean().default(true),
  scripts: ValidationScriptMappingSchema.default({
    typecheck: [],
    lint: [],
    test: []
  })
});

export const CwConfigSchema = z.object({
  version: z.literal(1),
  defaultWorkerId: z.string().min(1).optional(),
  workerClientCommand: z.string().min(1).optional(),
  workerModel: CwModelConfigSchema.optional(),
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
    retentionDays: 30,
    maxStoredSessions: 100
  }),
  validation: CwValidationConfigSchema.default({
    autoDiscover: true,
    scripts: {
      typecheck: [],
      lint: [],
      test: []
    }
  })
});

export type CwModelConfig = z.infer<typeof CwModelConfigSchema>;
export type CwConfig = z.infer<typeof CwConfigSchema>;
