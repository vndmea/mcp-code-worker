import { z } from "zod";

export const WorkerTaskTypeSchema = z.enum([
  "summarization",
  "codegen",
  "patch-generation",
  "test-generation",
  "log-analysis",
  "json-extraction",
  "review-lite"
]);

export const WorkerInterviewTaskTypeSchema = z.enum([
  "instruction-following",
  "structured-output",
  "scope-discipline",
  "summarization",
  "code-understanding",
  "codegen",
  "confidence-calibration"
]);

export const WorkerInterviewFailureKindSchema = z.enum([
  "provider-invocation",
  "json-parse",
  "schema-validation"
]);

export const WorkerStatusSchema = z.enum(["active", "limited", "blocked"]);

export const WorkerEvaluationScoreSchema = z.object({
  instructionFollowing: z.number().min(0).max(1),
  structuredOutput: z.number().min(0).max(1),
  reasoning: z.number().min(0).max(1),
  codeQuality: z.number().min(0).max(1),
  domainKnowledge: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1)
});

export const WorkerAdmissionDecisionSchema = z.object({
  passed: z.boolean(),
  blockingReasons: z.array(z.string())
});

export const WorkerCapabilityPortraitSchema = z.object({
  scopeDiscipline: z.number().min(0).max(1),
  repoGrounding: z.number().min(0).max(1),
  answerDirectness: z.number().min(0).max(1),
  codeUnderstanding: z.number().min(0).max(1),
  fixPlanning: z.number().min(0).max(1),
  implementationPlanning: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1)
});

export const WorkerTaskScoreCardSchema = z.object({
  summarization: z.number().min(0).max(1),
  codegen: z.number().min(0).max(1),
  patchGeneration: z.number().min(0).max(1),
  testGeneration: z.number().min(0).max(1),
  logAnalysis: z.number().min(0).max(1),
  jsonExtraction: z.number().min(0).max(1),
  reviewLite: z.number().min(0).max(1)
});

export const WorkerInterviewEvidenceSchema = z.object({
  failedCases: z.array(z.string()),
  repoGroundedCases: z.array(z.string()),
  fallbackPatternCases: z.array(z.string()),
  genericAnswerCases: z.array(z.string())
});

export const WorkerRoutingPolicySchema = z.object({
  maxTaskComplexity: z.enum(["low", "medium", "high"]),
  requiresHostReview: z.boolean(),
  allowCodegen: z.boolean(),
  allowPatchGeneration: z.boolean(),
  allowDomainTasks: z.boolean()
});

export const WorkerEvaluationSummarySchema = z.object({
  suiteName: z.string().min(1),
  suiteVersion: z.string().min(1),
  sampleCount: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  confidenceBand: z.enum(["low", "medium", "high"]),
  knownFailureModes: z.array(z.string())
});

export const WorkerInterviewDiagnosticsSchema = z.object({
  outcome: z.enum(["completed", "provider-error"]),
  providerInvocationFailures: z.number().int().nonnegative(),
  failedTaskCount: z.number().int().nonnegative(),
  recommendedActions: z.array(z.string())
});

export const WorkerInterviewPersistenceAdviceSchema = z.object({
  canPersist: z.boolean(),
  reason: z.string().min(1),
  recommendedActions: z.array(z.string())
});

export const WorkerCapabilityProfileSchema = z.object({
  workerId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  status: WorkerStatusSchema,
  supportedTaskTypes: z.array(WorkerTaskTypeSchema),
  unsupportedTaskTypes: z.array(z.string()),
  score: WorkerEvaluationScoreSchema,
  risks: z.array(z.string()),
  warnings: z.array(z.string()),
  routingPolicy: WorkerRoutingPolicySchema,
  evaluatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  suiteName: z.string().min(1).optional(),
  suiteVersion: z.string().min(1).optional(),
  evaluationSummary: WorkerEvaluationSummarySchema.optional(),
  interviewDiagnostics: WorkerInterviewDiagnosticsSchema.optional(),
  admission: WorkerAdmissionDecisionSchema.optional(),
  portrait: WorkerCapabilityPortraitSchema.optional(),
  taskScores: WorkerTaskScoreCardSchema.optional(),
  evidence: WorkerInterviewEvidenceSchema.optional()
});

export const WorkerInterviewTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: WorkerInterviewTaskTypeSchema,
  prompt: z.string().min(1),
  expectedOutputDescription: z.string().min(1)
});

export const WorkerInterviewTaskResultSchema = z.object({
  taskId: z.string().min(1),
  type: WorkerInterviewTaskTypeSchema,
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  findings: z.array(z.string()),
  rawOutput: z.unknown(),
  failureKind: WorkerInterviewFailureKindSchema.optional()
});

export const WorkerInterviewResultSchema = z.object({
  workerId: z.string().min(1),
  profile: WorkerCapabilityProfileSchema,
  status: WorkerStatusSchema,
  taskResults: z.array(WorkerInterviewTaskResultSchema),
  warnings: z.array(z.string()),
  interviewDiagnostics: WorkerInterviewDiagnosticsSchema,
  persistenceAdvice: WorkerInterviewPersistenceAdviceSchema
});

export const WorkerEvaluationSuiteSchema = z.object({
  name: z.string().min(1),
  tasks: z.array(WorkerInterviewTaskSchema)
});

export const WorkerBenchmarkFixtureResultSchema = z.object({
  fixtureId: z.string().min(1),
  title: z.string().min(1),
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  findings: z.array(z.string()),
  rawOutput: z.unknown()
});

export const WorkerBenchmarkResultSchema = z.object({
  workerId: z.string().min(1),
  suiteName: z.string().min(1),
  suiteVersion: z.string().min(1),
  fixtureResults: z.array(WorkerBenchmarkFixtureResultSchema),
  evaluationSummary: WorkerEvaluationSummarySchema
});

export type WorkerBenchmarkFixtureResult = z.infer<
  typeof WorkerBenchmarkFixtureResultSchema
>;
export type WorkerBenchmarkResult = z.infer<typeof WorkerBenchmarkResultSchema>;
