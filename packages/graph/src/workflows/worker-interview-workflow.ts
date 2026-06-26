import { createHash, randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type {
  AgentTask,
  ExecutionContext,
  ModelConfig,
  WorkerCapabilityProfile,
  WorkerInterviewDiagnostics,
  WorkerInterviewPersistenceAdvice,
  WorkerEvaluationScore,
  WorkerEvaluationSuite,
  WorkerInterviewResult,
  WorkerInterviewTask,
  WorkerInterviewTaskResult,
  WorkerInterviewTaskType,
  WorkflowState,
  WorkerTaskType
} from "@agent-orchestrator/core";
import {
  WorkerCapabilityProfileSchema,
  resolveExecutionContext
} from "@agent-orchestrator/core";
import { ModelRouter, invokeStructured } from "@agent-orchestrator/models";

import { createInitialWorkflowState } from "../leader/leader-state.js";

interface InterviewTaskRuntimeDefinition {
  task: WorkerInterviewTask;
  schema: z.ZodType<unknown>;
  mockResponse: unknown;
  mapRawOutputToTaskTypes: WorkerTaskType[];
  evaluateParsed: (parsed: unknown) => { findings: string[]; score: number };
}

export interface WorkerInterviewWorkflowInput {
  context?: ExecutionContext;
  modelConfig?: ModelConfig;
  simulatedResponses?: Partial<Record<WorkerInterviewTaskType, unknown>>;
  workerId?: string;
}

export interface WorkerInterviewWorkflowOutput extends WorkerInterviewResult {
  suite: WorkerEvaluationSuite;
}

interface WorkerInterviewSuiteIdentity {
  modelConfig?: ModelConfig;
  workerId?: string;
}

const WORKER_EVALUATION_SUITE_NAME = "default-worker-onboarding-suite";
const WORKER_EVALUATION_SUITE_VERSION = "3";

const InterviewState = Annotation.Root({
  task: Annotation<WorkflowState["task"]>(),
  plan: Annotation<WorkflowState["plan"]>(),
  workerResults: Annotation<WorkflowState["workerResults"]>(),
  toolResults: Annotation<WorkflowState["toolResults"]>(),
  review: Annotation<WorkflowState["review"]>(),
  finalResult: Annotation<WorkflowState["finalResult"]>(),
  workerCapabilityProfile: Annotation<WorkflowState["workerCapabilityProfile"]>(),
  warnings: Annotation<WorkflowState["warnings"]>(),
  errors: Annotation<WorkflowState["errors"]>()
});

const clampScore = (value: number): number =>
  Math.max(0, Math.min(1, Number(value.toFixed(2))));

const extractConfidence = (parsed: unknown): number | null => {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const maybeConfidence = (parsed as Record<string, unknown>).confidence;
  return typeof maybeConfidence === "number" ? maybeConfidence : null;
};

const deriveSuiteSeed = (identity: WorkerInterviewSuiteIdentity): string => {
  if (identity.workerId) {
    return identity.workerId;
  }

  if (identity.modelConfig) {
    return `${identity.modelConfig.provider}:${identity.modelConfig.model}`;
  }

  return "default:worker-interview";
};

const createPromptId = (seed: string, taskType: WorkerInterviewTaskType): string =>
  createHash("sha256")
    .update(`${WORKER_EVALUATION_SUITE_VERSION}:${seed}:${taskType}`)
    .digest("hex")
    .slice(0, 10);

const pickVariant = <T>(
  seed: string,
  taskType: WorkerInterviewTaskType,
  variants: T[]
): T => {
  const digest = createHash("sha256")
    .update(`${WORKER_EVALUATION_SUITE_VERSION}:${seed}:${taskType}:variant`)
    .digest("hex");
  const numeric = Number.parseInt(digest.slice(0, 8), 16);
  return variants[numeric % variants.length] ?? variants[0]!;
};

const createPrompt = (
  seed: string,
  taskType: WorkerInterviewTaskType,
  lines: string[]
): string =>
  [
    `Scenario ID: ${createPromptId(seed, taskType)}.`,
    "Use the scenario details directly and do not mention the scenario ID in your answer.",
    ...lines
  ].join("\n");

const strictJsonContractLines = (
  lines: string[],
  example?: string
): string[] => [
  "Return only valid JSON.",
  "Do not include markdown, explanations, reasoning text, or code fences.",
  "Use JSON numbers for numeric fields, not percentages or quoted strings.",
  "Use JSON arrays for array fields, not bullet lists or newline-delimited strings.",
  ...(example ? [`Example valid JSON shape: ${example}`] : []),
  ...lines
];

const instructionFollowingVariants = [
  [
    'Return exactly JSON with {"mode":"json-only","confidence":0.4} and nothing else.',
    "Do not add markdown, prose, or extra keys."
  ],
  [
    'Output must be exactly {"mode":"json-only","confidence":0.4}.',
    "Return valid JSON only with no explanation."
  ],
  [
    'Respond with the exact JSON object {"mode":"json-only","confidence":0.4}.',
    "No surrounding text is allowed."
  ]
];

const structuredOutputVariants = [
  strictJsonContractLines(
    [
      "Analyze the incident summary below.",
      "Use exactly these keys and types:",
      '- summary: string',
      '- risks: string[]',
      '- confidence: number between 0 and 1',
      '- files: string[]',
      "Return at least one risk and at least one file.",
      "Incident summary:",
      "- Build failed after a worker routing change.",
      "- Stale worker profiles were accepted without revalidation.",
      "- Affected files: packages/models/src/router/worker-profile-resolution.ts, packages/graph/src/workflows/leader-worker-workflow.ts.",
      "- Main risk: a blocked worker could be routed into production tasks."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.85,"files":["path.ts"]}'
  ),
  strictJsonContractLines(
    [
      "Review the release incident notes below.",
      "Use exactly these keys and types:",
      '- summary: string',
      '- risks: string[]',
      '- confidence: number between 0 and 1',
      '- files: string[]',
      "Return at least one risk and at least one file.",
      "Incident notes:",
      "- A hotfix changed model routing for worker selection.",
      "- The fallback branch skipped capability freshness checks.",
      "- Touched files: packages/models/src/router/model-router.ts, packages/graph/src/workflows/leader-worker-workflow.ts.",
      "- Main risk: low-quality workers may receive code generation tasks."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.78,"files":["path.ts"]}'
  ),
  strictJsonContractLines(
    [
      "Inspect the workflow regression summary below.",
      "Use exactly these keys and types:",
      '- summary: string',
      '- risks: string[]',
      '- confidence: number between 0 and 1',
      '- files: string[]',
      "Return at least one risk and at least one file.",
      "Regression summary:",
      "- Worker capability profiles were reused after a model swap.",
      "- A stale compatibility gate caused outdated scores to look valid.",
      "- Related files: packages/models/src/router/worker-profile-resolution.ts, packages/cli/src/commands/worker.ts.",
      "- Main risk: routing decisions may trust the wrong worker profile."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.81,"files":["path.ts"]}'
  )
];

const summarizationVariants = [
  strictJsonContractLines(
    [
      "Summarize the error log below as JSON.",
      "Use exactly these keys and types:",
      '- issue: string',
      '- impact: string',
      '- nextSteps: string[]',
      '- confidence: number between 0 and 1',
      "Return at least two nextSteps.",
      "Error log:",
      "TS2322: Type '{ score: string; }' is not assignable to type '{ score: number; }'.",
      "  at packages/models/src/router/worker-profile-store.ts:48:7",
      "Build failed for @agent-orchestrator/models."
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.95}'
  ),
  strictJsonContractLines(
    [
      "Convert the failure log below into JSON.",
      "Use exactly these keys and types:",
      '- issue: string',
      '- impact: string',
      '- nextSteps: string[]',
      '- confidence: number between 0 and 1',
      "Return at least two nextSteps.",
      "Failure log:",
      "Error: WORKER_PROFILE_REQUIRED",
      "  Persisted worker profile openai-compatible:deepseek-v4-pro has expired.",
      "  at packages/models/src/router/worker-profile-resolution.ts:132:9"
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.72}'
  ),
  strictJsonContractLines(
    [
      "Summarize the build failure below as JSON.",
      "Use exactly these keys and types:",
      '- issue: string',
      '- impact: string',
      '- nextSteps: string[]',
      '- confidence: number between 0 and 1',
      "Return at least two nextSteps.",
      "Build output:",
      "pnpm --filter @agent-orchestrator/cli build",
      "error TS6053: File 'packages/graph/dist/index.d.ts' not found.",
      "DTS build aborted for @agent-orchestrator/cli."
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.88}'
  )
];

const codeUnderstandingVariants = [
  strictJsonContractLines(
    [
      "Given this TypeScript function, return only JSON.",
      "Use exactly these keys and types:",
      '- behavior: string',
      '- risk: string',
      '- confidence: number between 0 and 1',
      "Code:",
      "function sumValidated(values: unknown[]): number {",
      "  return values",
      '    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))',
      "    .reduce((total, value) => total + value, 0);",
      "}"
    ],
    '{"behavior":"...","risk":"...","confidence":0.95}'
  ),
  strictJsonContractLines(
    [
      "Review this TypeScript helper and return only JSON.",
      "Use exactly these keys and types:",
      '- behavior: string',
      '- risk: string',
      '- confidence: number between 0 and 1',
      "Code:",
      "function sumScores(input: Array<number | null>): number {",
      "  return input",
      "    .filter((value): value is number => value !== null)",
      "    .reduce((sum, value) => sum + value, 0);",
      "}"
    ],
    '{"behavior":"...","risk":"...","confidence":0.9}'
  ),
  strictJsonContractLines(
    [
      "Explain the TypeScript function below using only JSON.",
      "Use exactly these keys and types:",
      '- behavior: string',
      '- risk: string',
      '- confidence: number between 0 and 1',
      "Code:",
      "function sumFinite(values: readonly unknown[]): number {",
      "  const filtered = values.filter((value): value is number =>",
      '    typeof value === "number" && Number.isFinite(value)',
      "  );",
      "  return filtered.reduce((total, value) => total + value, 0);",
      "}"
    ],
    '{"behavior":"...","risk":"...","confidence":0.83}'
  )
];

const codegenVariants = [
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      '- code: string',
      '- confidence: number between 0 and 1',
      "The code value must be strict TypeScript.",
      "It must define:",
      'export function validateScore(value: number): { ok: boolean; message?: string }',
      "The function must reject NaN and negative numbers."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.68}'
  ),
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      '- code: string',
      '- confidence: number between 0 and 1',
      "The code value must be strict TypeScript.",
      "Generate exactly this function signature:",
      'export function validateScore(value: number): { ok: boolean; message?: string }',
      "The implementation must reject non-finite values and values below zero."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.74}'
  ),
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      '- code: string',
      '- confidence: number between 0 and 1',
      "The code value must be strict TypeScript.",
      "Include this exact exported signature:",
      'export function validateScore(value: number): { ok: boolean; message?: string }',
      "Return ok=false for NaN or negative input."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.61}'
  )
];

const confidenceCalibrationVariants = [
  strictJsonContractLines(
    [
      "Answer the underspecified question below as JSON.",
      "Use exactly these keys and types:",
      '- answer: string',
      '- confidence: number between 0 and 1',
      '- uncertaintyReason: string',
      "Keep confidence low when the prompt lacks evidence.",
      "Question: Which deployment change caused yesterday's production latency spike?"
    ],
    '{"answer":"unknown","confidence":0.1,"uncertaintyReason":"missing evidence"}'
  ),
  strictJsonContractLines(
    [
      "Return only JSON for the ambiguous question below.",
      "Use exactly these keys and types:",
      '- answer: string',
      '- confidence: number between 0 and 1',
      '- uncertaintyReason: string',
      "Keep confidence low when the prompt lacks evidence.",
      "Question: Which engineer approved the risky routing patch last week?"
    ],
    '{"answer":"unknown","confidence":0.05,"uncertaintyReason":"missing evidence"}'
  ),
  strictJsonContractLines(
    [
      "Respond in JSON to the underdetermined question below.",
      "Use exactly these keys and types:",
      '- answer: string',
      '- confidence: number between 0 and 1',
      '- uncertaintyReason: string',
      "Keep confidence low when the prompt lacks evidence.",
      "Question: Which worker model should handle tomorrow's production hotfix?"
    ],
    '{"answer":"unknown","confidence":0.2,"uncertaintyReason":"missing evidence"}'
  )
];

const buildInterviewTasks = (
  identity: WorkerInterviewSuiteIdentity = {}
): InterviewTaskRuntimeDefinition[] => {
  const seed = deriveSuiteSeed(identity);

  return [
    {
    task: {
      id: "instruction-following",
      title: "Instruction Following",
      type: "instruction-following",
      prompt: createPrompt(
        seed,
        "instruction-following",
        pickVariant(seed, "instruction-following", instructionFollowingVariants)
      ),
      expectedOutputDescription: "Strict JSON-only output"
    },
    schema: z.object({
      mode: z.literal("json-only"),
      confidence: z.number().min(0).max(1)
    }),
    mockResponse: {
      mode: "json-only",
      confidence: 0.4
    },
    mapRawOutputToTaskTypes: [],
    evaluateParsed: (parsed) => {
      const value = parsed as { confidence: number; mode: string };
      return {
        score: value.mode === "json-only" ? 1 : 0.2,
        findings:
          value.mode === "json-only"
            ? []
            : ["Worker did not follow the exact output instruction."]
      };
    }
  },
    {
    task: {
      id: "structured-output",
      title: "Structured Output",
      type: "structured-output",
      prompt: createPrompt(
        seed,
        "structured-output",
        pickVariant(seed, "structured-output", structuredOutputVariants)
      ),
      expectedOutputDescription: "Valid JSON matching the requested schema"
    },
    schema: z.object({
      summary: z.string().min(1),
      risks: z.array(z.string()).min(1),
      files: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1)
    }),
    mockResponse: {
      summary: "Structured output is stable.",
      risks: ["Low confidence still requires review."],
      files: ["packages/graph/src/workflows/leader-worker-workflow.ts"],
      confidence: 0.66
    },
    mapRawOutputToTaskTypes: ["json-extraction"],
    evaluateParsed: (parsed) => ({
      score:
        ((parsed as { risks: string[] }).risks.length > 0 ? 1 : 0.6) *
        1,
      findings: []
    })
  },
    {
    task: {
      id: "summarization",
      title: "Summarization",
      type: "summarization",
      prompt: createPrompt(
        seed,
        "summarization",
        pickVariant(seed, "summarization", summarizationVariants)
      ),
      expectedOutputDescription: "Compact structured summary of a log"
    },
    schema: z.object({
      issue: z.string().min(1),
      impact: z.string().min(1),
      nextSteps: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1)
    }),
    mockResponse: {
      issue: "TypeScript reported a schema mismatch.",
      impact: "Workflow execution is blocked until the mismatch is fixed.",
      nextSteps: ["Review the schema.", "Run typecheck again."],
      confidence: 0.72
    },
    mapRawOutputToTaskTypes: ["summarization", "log-analysis"],
    evaluateParsed: (parsed) => ({
      score:
        (parsed as { nextSteps: string[] }).nextSteps.length >= 2 ? 0.9 : 0.6,
      findings: []
    })
  },
    {
    task: {
      id: "code-understanding",
      title: "Code Understanding",
      type: "code-understanding",
      prompt: createPrompt(
        seed,
        "code-understanding",
        pickVariant(seed, "code-understanding", codeUnderstandingVariants)
      ),
      expectedOutputDescription: "Structured code understanding notes"
    },
    schema: z.object({
      behavior: z.string().min(1),
      risk: z.string().min(1),
      confidence: z.number().min(0).max(1)
    }),
    mockResponse: {
      behavior: "The function sums validated numeric inputs and returns the total.",
      risk: "Missing validation on nested properties could allow bad input.",
      confidence: 0.7
    },
    mapRawOutputToTaskTypes: ["review-lite"],
    evaluateParsed: (parsed) => {
      const value = parsed as { behavior: string };
      return {
        score: value.behavior.toLowerCase().includes("sum") ? 0.88 : 0.5,
        findings: []
      };
    }
  },
    {
    task: {
      id: "codegen",
      title: "Simple Code Generation",
      type: "codegen",
      prompt: createPrompt(
        seed,
        "codegen",
        pickVariant(seed, "codegen", codegenVariants)
      ),
      expectedOutputDescription: "Runnable strict TypeScript snippet"
    },
    schema: z.object({
      code: z.string().min(1),
      confidence: z.number().min(0).max(1)
    }),
    mockResponse: {
      code: [
        "export function validateScore(value: number): { ok: boolean; message?: string } {",
        "  if (Number.isNaN(value)) {",
        "    return { ok: false, message: \"Value must be a number.\" };",
        "  }",
        "  if (value < 0) {",
        "    return { ok: false, message: \"Value must not be negative.\" };",
        "  }",
        "  return { ok: true };",
        "}"
      ].join("\n"),
      confidence: 0.68
    },
    mapRawOutputToTaskTypes: ["codegen", "test-generation"],
    evaluateParsed: (parsed) => {
      const code = (parsed as { code: string }).code;
      const findings: string[] = [];

      if (code.includes("any")) {
        findings.push("Generated code uses any.");
      }
      if (!code.includes("export function validateScore")) {
        findings.push("Expected function name was not generated.");
      }

      return {
        score: findings.length === 0 ? 0.86 : 0.35,
        findings
      };
    }
  },
    {
    task: {
      id: "confidence-calibration",
      title: "Confidence Calibration",
      type: "confidence-calibration",
      prompt: createPrompt(
        seed,
        "confidence-calibration",
        pickVariant(
          seed,
          "confidence-calibration",
          confidenceCalibrationVariants
        )
      ),
      expectedOutputDescription: "Cautious confidence on ambiguous prompts"
    },
    schema: z.object({
      answer: z.string().min(1),
      confidence: z.number().min(0).max(1),
      uncertaintyReason: z.string().min(1)
    }),
    mockResponse: {
      answer: "I do not have enough evidence to answer reliably.",
      confidence: 0.24,
      uncertaintyReason: "The prompt does not include enough context."
    },
    mapRawOutputToTaskTypes: [],
    evaluateParsed: (parsed) => {
      const confidence = extractConfidence(parsed) ?? 1;
      return {
        score: confidence <= 0.45 ? 0.92 : 0.2,
        findings:
          confidence <= 0.45
            ? []
            : ["Worker reported high confidence on an ambiguous task."]
      };
    }
  }
  ];
};

const createTaskResult = async (
  runtimeTask: InterviewTaskRuntimeDefinition,
  router: ModelRouter,
  modelConfig: ModelConfig,
  simulatedResponses: Partial<Record<WorkerInterviewTaskType, unknown>>
): Promise<WorkerInterviewTaskResult> => {
  const provider = router.route("worker").provider;
  const mockResponse =
    simulatedResponses[runtimeTask.task.type] ?? runtimeTask.mockResponse;

  if (mockResponse instanceof Error) {
    return {
      taskId: runtimeTask.task.id,
      type: runtimeTask.task.type,
      passed: false,
      score: 0,
      findings: [`Attempt 1: provider invocation failed: ${mockResponse.message}`],
      rawOutput: null,
      failureKind: "provider-invocation"
    };
  }

  const invocation = await invokeStructured({
    provider,
    config: modelConfig,
    schema: runtimeTask.schema,
    prompt: runtimeTask.task.prompt,
    mockResponse,
    maxAttempts: 2
  });

  if (!invocation.ok) {
    return {
      taskId: runtimeTask.task.id,
      type: runtimeTask.task.type,
      passed: false,
      score: 0,
      findings: invocation.errors.length > 0
        ? invocation.errors
        : ["Worker interview execution failed."],
      rawOutput: invocation.raw ?? invocation.rawText,
      failureKind: invocation.failureKind
    };
  }

  const evaluation = runtimeTask.evaluateParsed(invocation.data);
  return {
    taskId: runtimeTask.task.id,
    type: runtimeTask.task.type,
    passed: evaluation.score >= 0.6,
    score: clampScore(evaluation.score),
    findings: evaluation.findings,
    rawOutput: invocation.data
  };
};

const average = (values: number[]): number =>
  clampScore(values.reduce((sum, value) => sum + value, 0) / values.length);

const addDays = (isoDate: string, days: number): string => {
  const base = Date.parse(isoDate);
  return new Date(base + days * 86_400_000).toISOString();
};

const providerFailureRecoveryActions = [
  "Verify the worker base URL and model name.",
  "Confirm the configured API key environment variable is populated.",
  "Run a direct provider health check before retrying the interview.",
  "Re-run `ao worker interview --save` after connectivity is stable."
];

const buildInterviewDiagnostics = (
  taskResults: WorkerInterviewTaskResult[]
): WorkerInterviewDiagnostics => {
  const providerInvocationFailures = taskResults.filter(
    (result) => result.failureKind === "provider-invocation"
  ).length;

  return {
    outcome: providerInvocationFailures > 0 ? "provider-error" : "completed",
    providerInvocationFailures,
    failedTaskCount: taskResults.filter((result) => !result.passed).length,
    recommendedActions:
      providerInvocationFailures > 0
        ? providerFailureRecoveryActions
        : [
            "Persist the interview result only after reviewing the warnings.",
            "Run the coding benchmark before enabling patch generation."
          ]
  };
};

const buildPersistenceAdvice = (
  workerId: string,
  diagnostics: WorkerInterviewDiagnostics
): WorkerInterviewPersistenceAdvice =>
  diagnostics.outcome === "provider-error"
    ? {
        canPersist: false,
        reason: `Worker interview for ${workerId} hit provider invocation failures. Fix provider connectivity before persisting a profile.`,
        recommendedActions: diagnostics.recommendedActions
      }
    : {
        canPersist: true,
        reason: `Worker profile ${workerId} is eligible to persist.`,
        recommendedActions: diagnostics.recommendedActions
      };

const buildCapabilityProfile = (
  workerId: string,
  modelConfig: ModelConfig,
  taskResults: WorkerInterviewTaskResult[],
  runtimeTasks: InterviewTaskRuntimeDefinition[]
): WorkerCapabilityProfile => {
  const scoreByType = new Map(taskResults.map((result) => [result.type, result.score]));
  const interviewDiagnostics = buildInterviewDiagnostics(taskResults);
  const structuredOutput = average([
    scoreByType.get("instruction-following") ?? 0,
    scoreByType.get("structured-output") ?? 0,
    scoreByType.get("structured-output") ?? 0
  ]);
  const reasoning = average([
    scoreByType.get("summarization") ?? 0,
    scoreByType.get("code-understanding") ?? 0
  ]);
  const codeQuality = scoreByType.get("codegen") ?? 0;
  const reliability = average(taskResults.map((result) => result.score));
  const score: WorkerEvaluationScore = {
    instructionFollowing: scoreByType.get("instruction-following") ?? 0,
    structuredOutput,
    reasoning,
    codeQuality,
    domainKnowledge: scoreByType.get("code-understanding") ?? 0,
    reliability
  };

  const supported = new Set<WorkerTaskType>();

  if (structuredOutput >= 0.7 && (scoreByType.get("summarization") ?? 0) >= 0.65) {
    supported.add("summarization");
    supported.add("log-analysis");
    supported.add("json-extraction");
  }
  if (structuredOutput >= 0.7 && (scoreByType.get("code-understanding") ?? 0) >= 0.65) {
    supported.add("review-lite");
  }
  if (
    structuredOutput >= 0.75 &&
    codeQuality >= 0.75 &&
    score.instructionFollowing >= 0.7
  ) {
    supported.add("codegen");
    supported.add("test-generation");
  }

  const unsupportedTaskTypes = Array.from(
    new Set(
      runtimeTasks.flatMap((item) => item.mapRawOutputToTaskTypes).filter(
        (taskType) => !supported.has(taskType)
      )
    )
  );

  const warnings = taskResults
    .filter((result) => !result.passed || result.findings.length > 0)
    .flatMap((result) => result.findings.map((finding) => `${result.type}: ${finding}`));

  if (interviewDiagnostics.outcome === "provider-error") {
    warnings.push(
      "Interview hit provider invocation failures. Do not persist this profile until provider access is verified."
    );
  }

  const risks = [...warnings];

  const status =
    structuredOutput < 0.45 || score.reliability < 0.45 || supported.size === 0
      ? "blocked"
      : codeQuality < 0.75 || score.reliability < 0.75
        ? "limited"
        : "active";

  const profile: WorkerCapabilityProfile = {
    workerId,
    provider: modelConfig.provider,
    model: modelConfig.model,
    status,
    supportedTaskTypes: Array.from(supported),
    unsupportedTaskTypes,
    score,
    risks,
    warnings,
    routingPolicy: {
      maxTaskComplexity:
        status === "active"
          ? score.reliability >= 0.9
            ? "high"
            : "medium"
          : status === "limited"
            ? "low"
            : "low",
      requiresLeaderReview: status !== "active" || score.reliability < 0.85,
      allowCodegen: supported.has("codegen"),
      allowPatchGeneration:
        supported.has("codegen") && codeQuality >= 0.82 && score.reliability >= 0.8,
      allowDomainTasks:
        status === "active" && score.domainKnowledge >= 0.75
    },
    evaluatedAt: new Date().toISOString(),
    expiresAt: addDays(new Date().toISOString(), 30),
    suiteName: WORKER_EVALUATION_SUITE_NAME,
    suiteVersion: WORKER_EVALUATION_SUITE_VERSION,
    interviewDiagnostics
  };

  return WorkerCapabilityProfileSchema.parse(profile);
};

export const createDefaultWorkerEvaluationSuite = (
  identity: WorkerInterviewSuiteIdentity = {}
): WorkerEvaluationSuite => ({
  name: WORKER_EVALUATION_SUITE_NAME,
  tasks: buildInterviewTasks(identity).map((item) => item.task)
});

export const runWorkerInterviewWorkflow = async (
  input: WorkerInterviewWorkflowInput = {}
): Promise<WorkerInterviewWorkflowOutput> => {
  const context = input.context ?? await resolveExecutionContext();
  const modelConfig = input.modelConfig ?? context.workerModel;
  const workerId = input.workerId ?? ModelRouter.deriveWorkerId(modelConfig);
  const router = new ModelRouter(context.leaderModel, modelConfig);
  const runtimeTasks = buildInterviewTasks({
    modelConfig,
    workerId
  });
  const task: AgentTask = {
    id: randomUUID(),
    goal: `Evaluate worker onboarding capability for ${workerId}`,
    constraints: [
      "Assess instruction following, structured output, summarization, code understanding, code generation, and confidence calibration.",
      "Warn when the worker should be limited or blocked."
    ],
    assignedRole: "leader",
    priority: "high",
    metadata: {
      workflow: "worker-interview-workflow",
      workerId
    }
  };

  const app = new StateGraph(InterviewState)
    .addNode("run_suite", async (state) => {
      const taskResults = await Promise.all(
        runtimeTasks.map((runtimeTask) =>
          createTaskResult(
            runtimeTask,
            router,
            modelConfig,
            input.simulatedResponses ?? {}
          )
        )
      );
      const profile = buildCapabilityProfile(
        workerId,
        modelConfig,
        taskResults,
        runtimeTasks
      );
      const warnings =
        profile.status === "active"
          ? []
          : [
              `Worker ${workerId} failed onboarding evaluation.`,
              `Status: ${profile.status}`,
              ...profile.warnings
            ];

      return {
        ...state,
        workerResults: [],
        toolResults: taskResults.map((result) => ({
          toolName: `worker-interview:${result.type}`,
          status: result.passed ? "success" : "failure",
          output: result,
          metadata: {}
        })),
        workerCapabilityProfile: profile,
        warnings
      };
    })
    .addEdge(START, "run_suite")
    .addEdge("run_suite", END)
    .compile();

  const state = await app.invoke(createInitialWorkflowState(task));
  const taskResults = state.toolResults.map(
    (result) => result.output as WorkerInterviewTaskResult
  );
  const profile =
    state.workerCapabilityProfile ??
    buildCapabilityProfile(workerId, modelConfig, taskResults, runtimeTasks);
  const interviewDiagnostics =
    profile.interviewDiagnostics ?? buildInterviewDiagnostics(taskResults);
  const persistenceAdvice = buildPersistenceAdvice(
    workerId,
    interviewDiagnostics
  );

  return {
    workerId,
    profile,
    status: profile.status,
    taskResults,
    warnings: state.warnings,
    interviewDiagnostics,
    persistenceAdvice,
    suite: {
      name: WORKER_EVALUATION_SUITE_NAME,
      tasks: runtimeTasks.map((item) => item.task)
    }
  };
};
