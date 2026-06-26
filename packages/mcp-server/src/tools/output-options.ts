import { z } from "zod";

import type { WorkflowOutputOptions } from "@agent-orchestrator/graph";

export const workflowOutputOptionShape = {
  detailLevel: z.enum(["summary", "full"]).optional(),
  includeArtifactRefs: z.boolean().optional(),
  maxBytes: z.number().int().positive().max(200_000).optional()
};

export const resolveWorkflowOutputOptions = (
  args: Partial<{
    detailLevel: "summary" | "full";
    includeArtifactRefs: boolean;
    maxBytes: number;
  }>
): WorkflowOutputOptions => ({
  detailLevel: args.detailLevel ?? "summary",
  includeArtifactRefs: args.includeArtifactRefs ?? true,
  maxBytes: args.maxBytes
});
