import { z } from "zod";

export const WorkerRegistrationSchema = z.object({
  workerId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const WorkerRegistrySchema = z.object({
  version: z.literal(1),
  workers: z.array(WorkerRegistrationSchema)
});

export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;
export type WorkerRegistry = z.infer<typeof WorkerRegistrySchema>;
