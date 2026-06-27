import { z } from "zod";

export const AgentRoleSchema = z.enum(["worker", "reviewer", "tool"]);
export const TaskPrioritySchema = z.enum(["low", "medium", "high"]);

export const AgentTaskSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  input: z.unknown().optional(),
  constraints: z.array(z.string()),
  expectedOutput: z.string().min(1).optional(),
  assignedRole: AgentRoleSchema,
  priority: TaskPrioritySchema,
  metadata: z.record(z.string(), z.unknown())
});
