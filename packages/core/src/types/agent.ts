import type { ZodType } from "zod";

export type AgentRole = "worker" | "reviewer" | "tool";
export type WorkerTaskType =
  | "summarization"
  | "codegen"
  | "patch-generation"
  | "test-generation"
  | "log-analysis"
  | "json-extraction"
  | "review-lite";
export type WorkerInterviewTaskType =
  | "instruction-following"
  | "structured-output"
  | "scope-discipline"
  | "summarization"
  | "code-understanding"
  | "codegen"
  | "confidence-calibration";
export type WorkerInterviewFailureKind =
  | "provider-invocation"
  | "json-parse"
  | "schema-validation";
export type WorkerStatus = "active" | "limited" | "blocked";

export type OrchestratorDecisionType =
  | "approve"
  | "revise"
  | "reject"
  | "human-review";

export interface OrchestratorDecision {
  taskId: string;
  decision: OrchestratorDecisionType;
  reason: string;
  nextActions: string[];
  requiresHumanReview: boolean;
}

export type WorkerCostTier = "low" | "medium" | "high";

export interface WorkerCapability {
  name: string;
  description: string;
  inputSchema: ZodType;
  outputSchema: ZodType;
  supportedTaskTypes: WorkerTaskType[];
  preferredModel?: string;
  costTier: WorkerCostTier;
}

export interface WorkerEvaluationScore {
  instructionFollowing: number;
  structuredOutput: number;
  reasoning: number;
  codeQuality: number;
  domainKnowledge: number;
  reliability: number;
}

export interface WorkerAdmissionDecision {
  passed: boolean;
  blockingReasons: string[];
}

export interface WorkerCapabilityPortrait {
  scopeDiscipline: number;
  repoGrounding: number;
  answerDirectness: number;
  codeUnderstanding: number;
  fixPlanning: number;
  implementationPlanning: number;
  consistency: number;
}

export interface WorkerTaskScoreCard {
  summarization: number;
  codegen: number;
  patchGeneration: number;
  testGeneration: number;
  logAnalysis: number;
  jsonExtraction: number;
  reviewLite: number;
}

export interface WorkerInterviewEvidence {
  failedCases: string[];
  repoGroundedCases: string[];
  fallbackPatternCases: string[];
  genericAnswerCases: string[];
}

export interface WorkerRoutingPolicy {
  maxTaskComplexity: "low" | "medium" | "high";
  requiresHostReview: boolean;
  allowCodegen: boolean;
  allowPatchGeneration: boolean;
  allowDomainTasks: boolean;
}

export interface WorkerInterviewDiagnostics {
  outcome: "completed" | "provider-error";
  providerInvocationFailures: number;
  failedTaskCount: number;
  recommendedActions: string[];
}

export interface WorkerInterviewPersistenceAdvice {
  canPersist: boolean;
  reason: string;
  recommendedActions: string[];
}

export interface WorkerCapabilityProfile {
  workerId: string;
  provider: string;
  model: string;
  status: WorkerStatus;
  supportedTaskTypes: WorkerTaskType[];
  unsupportedTaskTypes: string[];
  score: WorkerEvaluationScore;
  risks: string[];
  warnings: string[];
  routingPolicy: WorkerRoutingPolicy;
  evaluatedAt: string;
  expiresAt?: string;
  suiteName?: string;
  suiteVersion?: string;
  evaluationSummary?: WorkerEvaluationSummary;
  interviewDiagnostics?: WorkerInterviewDiagnostics;
  admission?: WorkerAdmissionDecision;
  portrait?: WorkerCapabilityPortrait;
  taskScores?: WorkerTaskScoreCard;
  evidence?: WorkerInterviewEvidence;
}

export interface WorkerEvaluationSummary {
  suiteName: string;
  suiteVersion: string;
  sampleCount: number;
  passedCount: number;
  failedCount: number;
  confidenceBand: "low" | "medium" | "high";
  knownFailureModes: string[];
}

export interface WorkerInterviewTask {
  id: string;
  title: string;
  type: WorkerInterviewTaskType;
  prompt: string;
  expectedOutputDescription: string;
}

export interface WorkerInterviewTaskResult {
  taskId: string;
  type: WorkerInterviewTaskType;
  passed: boolean;
  score: number;
  findings: string[];
  rawOutput: unknown;
  failureKind?: WorkerInterviewFailureKind;
}

export interface WorkerInterviewResult {
  workerId: string;
  profile: WorkerCapabilityProfile;
  status: WorkerStatus;
  taskResults: WorkerInterviewTaskResult[];
  warnings: string[];
  interviewDiagnostics: WorkerInterviewDiagnostics;
  persistenceAdvice: WorkerInterviewPersistenceAdvice;
}

export interface WorkerEvaluationSuite {
  name: string;
  tasks: WorkerInterviewTask[];
}
