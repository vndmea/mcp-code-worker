import { z } from "zod";

export const ModelConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  clientCommand: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
});
