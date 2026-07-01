import { z } from "zod";

import { ModelConfigSchema } from "./model-config.schema.js";
import { RepositoryContextPackSchema } from "./repository-context.schema.js";
import {
  WorkerTaskTypeSchema,
  WorkerTrustProfileSchema
} from "./worker-capability.schema.js";

export const WorkerHostSchema = z.enum(["codex"]);

export const WorkerTaskEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    taskType: WorkerTaskTypeSchema,
    objective: z.string().min(1),
    host: WorkerHostSchema,
    model: ModelConfigSchema,
    constraints: z.array(z.string()),
    context: z
      .object({
        repository: RepositoryContextPackSchema.optional(),
        errorLog: z.string().optional(),
        scope: z.string().optional()
      })
      .strict(),
    outputContract: z
      .object({
        contractId: z.string().min(1),
        schemaVersion: z.string().min(1)
      })
      .strict(),
    trace: z
      .object({
        createdAt: z.string().datetime(),
        sourceWorkflow: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const WorkerResultStatusSchema = z.enum([
  "ok",
  "needs_more_context",
  "blocked",
  "invalid_output",
  "host_takeover"
]);

export const WorkerResultEnvelopeSchema = z
  .object({
    taskEnvelopeId: z.string().min(1),
    taskType: WorkerTaskTypeSchema,
    status: WorkerResultStatusSchema,
    output: z.unknown().optional(),
    failure: z
      .object({
        kind: z.enum([
          "provider-invocation",
          "json-parse",
          "schema-validation",
          "semantic-validation",
          "policy-blocked"
        ]),
        reasons: z.array(z.string())
      })
      .strict()
      .optional(),
    diagnostics: z
      .object({
        modelBehaviorProfile: z.string().min(1).optional(),
        structuredOutputAttempts: z.number().int().nonnegative(),
        structuredOutputFallbackReason: z.string().optional(),
        structuredOutputMode: z.enum([
          "none",
          "native-json-schema",
          "prompt-only-json"
        ])
      })
      .strict()
  })
  .strict();

export const WorkerTaskExecutionRecordSchema = z
  .object({
    id: z.string().min(1),
    taskEnvelope: WorkerTaskEnvelopeSchema,
    resultEnvelope: WorkerResultEnvelopeSchema.optional(),
    workerId: z.string().min(1).optional(),
    workerTrustProfile: WorkerTrustProfileSchema,
    status: WorkerResultStatusSchema,
    diagnostics: z.record(z.string(), z.unknown()).default({}),
    artifactRefs: z.array(z.string()).default([]),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional()
  })
  .strict();

export type WorkerTaskEnvelope = z.infer<typeof WorkerTaskEnvelopeSchema>;
export type WorkerResultEnvelope = z.infer<typeof WorkerResultEnvelopeSchema>;
export type WorkerResultStatus = z.infer<typeof WorkerResultStatusSchema>;
export type WorkerTaskExecutionRecord = z.infer<
  typeof WorkerTaskExecutionRecordSchema
>;
