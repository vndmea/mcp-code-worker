import { z } from "zod";

export const TaskSessionStatusSchema = z.enum([
  "created",
  "context-built",
  "reviewed",
  "fix-planned",
  "patch-proposed",
  "patch-inspected",
  "patch-applied",
  "validated",
  "needs-review",
  "completed",
  "failed",
  "blocked"
]);

export const TaskSessionStepStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failure",
  "skipped",
  "blocked"
]);

export const TaskSessionStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: TaskSessionStepStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  artifactPath: z.string().optional()
});

export const TaskSessionSchema = z.object({
  taskId: z.string().min(1),
  goal: z.string().min(1),
  scope: z.string().optional(),
  workerId: z.string().optional(),
  requireProfile: z.boolean().default(false),
  status: TaskSessionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  steps: z.array(TaskSessionStepSchema),
  artifacts: z.record(z.string(), z.string()).default({}),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type TaskSessionStatus = z.infer<typeof TaskSessionStatusSchema>;
export type TaskSessionStepStatus = z.infer<typeof TaskSessionStepStatusSchema>;
export type TaskSessionStep = z.infer<typeof TaskSessionStepSchema>;
export type TaskSession = z.infer<typeof TaskSessionSchema>;
