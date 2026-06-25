import { randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type {
  AgentTask,
  ExecutionContext,
  ModelConfig,
  WorkerCapabilityProfile,
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
  createExecutionContextFromEnv
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

const buildInterviewTasks = (): InterviewTaskRuntimeDefinition[] => [
  {
    task: {
      id: "instruction-following",
      title: "Instruction Following",
      type: "instruction-following",
      prompt:
        'Return exactly JSON with {"mode":"json-only","confidence":0.4} and nothing else.',
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
      prompt:
        "Return JSON with summary, risks, confidence, and files. Do not include markdown.",
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
      prompt:
        "Summarize this error log into issue, impact, and nextSteps fields as JSON.",
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
      prompt:
        "Given a TypeScript function that validates input and returns a sum, explain behavior and one risk in JSON.",
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
      prompt:
        "Return JSON with a strict TypeScript function named validateScore that validates a number and returns a structured result.",
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
      prompt:
        "Answer an underspecified question as JSON with answer, confidence, and uncertaintyReason. Keep confidence low if the prompt lacks evidence.",
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

const createTaskResult = async (
  runtimeTask: InterviewTaskRuntimeDefinition,
  router: ModelRouter,
  modelConfig: ModelConfig,
  simulatedResponses: Partial<Record<WorkerInterviewTaskType, unknown>>
): Promise<WorkerInterviewTaskResult> => {
  const provider = router.route("worker").provider;
  const mockResponse =
    simulatedResponses[runtimeTask.task.type] ?? runtimeTask.mockResponse;
  const invocation = await invokeStructured({
    provider,
    config: modelConfig,
    schema: runtimeTask.schema,
    prompt: runtimeTask.task.prompt,
    mockResponse,
    maxAttempts: 1
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
      rawOutput: invocation.raw ?? invocation.rawText
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

const buildCapabilityProfile = (
  workerId: string,
  modelConfig: ModelConfig,
  taskResults: WorkerInterviewTaskResult[],
  runtimeTasks: InterviewTaskRuntimeDefinition[]
): WorkerCapabilityProfile => {
  const scoreByType = new Map(taskResults.map((result) => [result.type, result.score]));
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
    evaluatedAt: new Date().toISOString()
  };

  return WorkerCapabilityProfileSchema.parse(profile);
};

export const createDefaultWorkerEvaluationSuite = (): WorkerEvaluationSuite => ({
  name: "default-worker-onboarding-suite",
  tasks: buildInterviewTasks().map((item) => item.task)
});

export const runWorkerInterviewWorkflow = async (
  input: WorkerInterviewWorkflowInput = {}
): Promise<WorkerInterviewWorkflowOutput> => {
  const context = input.context ?? createExecutionContextFromEnv();
  const modelConfig = input.modelConfig ?? context.workerModel;
  const workerId = input.workerId ?? ModelRouter.deriveWorkerId(modelConfig);
  const router = new ModelRouter(context.leaderModel, modelConfig);
  const runtimeTasks = buildInterviewTasks();
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
  const profile = state.workerCapabilityProfile ?? buildCapabilityProfile(workerId, modelConfig, taskResults, runtimeTasks);

  return {
    workerId,
    profile,
    status: profile.status,
    taskResults,
    warnings: state.warnings,
    suite: {
      name: "default-worker-onboarding-suite",
      tasks: runtimeTasks.map((item) => item.task)
    }
  };
};
