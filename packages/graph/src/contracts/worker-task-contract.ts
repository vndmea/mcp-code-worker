import { z, type ZodType } from "zod";

import type {
  AgentResult,
  WorkerCapability,
  WorkerTaskType
} from "@mcp-code-worker/core";

import {
  buildRepositoryContextPromptLines,
  getErrorLogFromTask,
  getRepositoryContextFromTask,
  type WorkerExecutionInput
} from "../workers/worker-agent.js";
import { createPatchGenerationWorkerTaskContract } from "./patch-generation-contract.js";

export interface WorkerTaskContract {
  agentId: string;
  artifacts: AgentResult["artifacts"];
  capability: WorkerCapability;
  confidence: number;
  debugLabel: string;
  fallbackOutput: (input: WorkerExecutionInput) => unknown;
  maxStructuredAttempts?: number;
  mockResponse?: (input: WorkerExecutionInput) => unknown;
  outputSchema: ZodType<unknown>;
  prompt: (input: WorkerExecutionInput) => string;
  risks: string[];
  schemaVersion: string;
  taskTypes: WorkerTaskType[];
}

export interface WorkerTaskContractResultOptions {
  agentId: string;
  artifacts: AgentResult["artifacts"];
  confidence: number;
  debugLabel: string;
  fallbackOutput: unknown;
  maxStructuredAttempts?: number;
  mockResponse?: unknown;
  outputSchema: ZodType<unknown>;
  prompt: string;
  risks: string[];
}

const contextPaths = (input: WorkerExecutionInput): string[] =>
  getRepositoryContextFromTask(input.task)?.selectedFiles.map((file) => file.path) ??
  [];

const standardInputSchema = z.object({
  errorLog: z.string().optional(),
  goal: z.string(),
  scope: z.string().optional()
});

const goalOnlyInputSchema = z.object({
  goal: z.string()
});

const reviewOutputSchema = z
  .object({
    answer: z.string().min(1),
    findings: z.array(z.string().min(1)),
    referencedFiles: z.array(z.string().min(1))
  })
  .strict();

const summarizeOutputSchema = z.object({
  brief: z.string(),
  focusAreas: z.array(z.string())
});

const codegenOutputSchema = z.object({
  patchPlan: z.array(z.string()),
  notes: z.array(z.string())
});

const testOutputSchema = z.object({
  suggestedTests: z.array(z.string())
});

const contracts: WorkerTaskContract[] = [
  {
    agentId: "worker.review",
    artifacts: [],
    capability: {
      name: "review-worker",
      description: "Performs a low-cost review pass to highlight likely risks.",
      inputSchema: goalOnlyInputSchema,
      outputSchema: reviewOutputSchema,
      supportedTaskTypes: ["review-lite", "risk-analysis", "code-understanding"],
      preferredModel: "worker",
      costTier: "low"
    },
    confidence: 0.77,
    debugLabel: "Direct review answer grounded in selected repository files",
    fallbackOutput: (input) => {
      const selectedPaths = contextPaths(input);

      return {
        answer:
          selectedPaths.length > 0
            ? `The current change looks partial until ${selectedPaths[0]} is verified end to end against the selected repository paths.`
            : "The current change is partial until the selected repository files are verified end to end.",
        findings: [
          ...(selectedPaths.length > 0
            ? [
                `${selectedPaths[0]} should be checked first for the highest-confidence workflow risk.`,
                `${selectedPaths[selectedPaths.length - 1]} should preserve dry-run behavior in CLI and MCP flows.`
              ]
            : [
                "repository-context should be checked first for the highest-confidence workflow risk.",
                "repository-context should preserve dry-run behavior in CLI and MCP flows."
              ]),
          ...(selectedPaths.length > 0
            ? [
                `${selectedPaths.join(", ")} must not expose unrestricted shell access through public interfaces.`
              ]
            : []),
          selectedPaths.length === 0
            ? "repository-context must not expose unrestricted shell access through public interfaces."
            : `${selectedPaths[0]} must keep review output grounded in the selected repository paths.`
        ],
        referencedFiles:
          selectedPaths.length > 0 ? selectedPaths : ["repository-context"]
      };
    },
    maxStructuredAttempts: 2,
    outputSchema: reviewOutputSchema,
    prompt: (input) => {
      const selectedPaths = contextPaths(input);
      const citedPathsLine =
        selectedPaths.length > 0
          ? `Allowed referencedFiles values: ${selectedPaths.join(", ")}.`
          : "Allowed referencedFiles values: only paths from the selected repository context.";

      return [
        "Return valid JSON only. Do not include markdown fences or explanatory prose.",
        'Return exactly one JSON object with keys "answer", "findings", and "referencedFiles".',
        "Do not include extra keys.",
        "The answer field must directly answer the goal and should state complete, partial, or incorrect when applicable.",
        "The findings field must be a JSON array of strings.",
        "The referencedFiles field must be a JSON array of strings.",
        "Focus on implementation and workflow risks.",
        "Every finding must include at least one exact full path copied from Allowed referencedFiles.",
        "Do not use basename-only file references such as rawXml2.ts or schemaMinimum.ts.",
        "A finding without an exact full selected path will be marked incomplete.",
        "Reference concrete repository file paths from the provided context only.",
        citedPathsLine,
        `Goal: ${input.task.goal}`,
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n");
    },
    risks: [],
    schemaVersion: "1.0.0",
    taskTypes: ["review-lite", "risk-analysis", "code-understanding"]
  },
  {
    agentId: "worker.summarize",
    artifacts: [],
    capability: {
      name: "summarize-worker",
      description: "Summarizes goals and scoped context into a compact execution brief.",
      inputSchema: standardInputSchema,
      outputSchema: summarizeOutputSchema,
      supportedTaskTypes: [
        "summarization",
        "log-analysis",
        "json-extraction",
        "doc-generation"
      ],
      preferredModel: "worker",
      costTier: "low"
    },
    confidence: 0.86,
    debugLabel: "Compact repository-grounded summary",
    fallbackOutput: (input) => {
      const selectedPaths = contextPaths(input);

      return {
        brief:
          selectedPaths.length > 0
            ? `Summarized ${input.task.goal} using ${selectedPaths.join(", ")}.`
            : `Summarized goal: ${input.task.goal}`,
        focusAreas: [
          ...(selectedPaths.length > 0
            ? [`Stay grounded in ${selectedPaths.join(", ")}.`]
            : []),
          input.scope
            ? `Scope work to ${input.scope}`
            : "Scope not provided; keep changes minimal.",
          "Preserve package boundaries.",
          "Prefer deterministic validation."
        ]
      };
    },
    outputSchema: summarizeOutputSchema,
    prompt: (input) => {
      const errorLog = getErrorLogFromTask(input.task);

      return [
        "Return JSON with keys brief and focusAreas.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided",
        errorLog ? `Error log:\n${errorLog}` : "Error log: not provided",
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n");
    },
    risks: [],
    schemaVersion: "1.0.0",
    taskTypes: [
      "summarization",
      "log-analysis",
      "json-extraction",
      "doc-generation"
    ]
  },
  {
    agentId: "worker.codegen",
    artifacts: [
      {
        name: "candidate-patch-plan.md",
        type: "text/markdown",
        content: "- Add contracts\n- Wire workflows\n- Validate before acceptance\n"
      }
    ],
    capability: {
      name: "codegen-worker",
      description: "Produces candidate implementation notes or patch plans.",
      inputSchema: standardInputSchema,
      outputSchema: codegenOutputSchema,
      supportedTaskTypes: ["codegen", "validation-fix"],
      preferredModel: "worker",
      costTier: "medium"
    },
    confidence: 0.72,
    debugLabel: "Structured patch-plan notes grounded in selected repository files",
    fallbackOutput: (input) => {
      const selectedPaths = contextPaths(input);

      return {
        patchPlan: [
          ...(selectedPaths.length > 0
            ? [`Start from ${selectedPaths[0]}.`]
            : []),
          "Add strict typed contracts before implementation.",
          "Keep writes gated behind policy checks.",
          "Return structured artifacts for review."
        ],
        notes: [
          ...(selectedPaths.length > 0
            ? [`Ground the plan in ${selectedPaths.join(", ")}.`]
            : []),
          input.scope
            ? `Limit implementation to ${input.scope}.`
            : "No scope provided.",
          "Candidate patches still require host review."
        ]
      };
    },
    outputSchema: codegenOutputSchema,
    prompt: (input) => {
      const errorLog = getErrorLogFromTask(input.task);

      return [
        "Return JSON with keys patchPlan and notes.",
        "Patch plans must stay dry-run and must not apply changes.",
        "Reference concrete repository file paths from the provided context.",
        `Goal: ${input.task.goal}`,
        input.scope ? `Scope: ${input.scope}` : "Scope: not provided",
        errorLog ? `Error log:\n${errorLog}` : "Error log: not provided",
        ...buildRepositoryContextPromptLines(input.task)
      ].join("\n");
    },
    risks: [
      "Generated code suggestions should not be accepted without deterministic validation."
    ],
    schemaVersion: "1.0.0",
    taskTypes: ["codegen", "validation-fix"]
  },
  {
    agentId: "worker.test",
    artifacts: [],
    capability: {
      name: "test-worker",
      description: "Suggests workflow and policy coverage to validate changes.",
      inputSchema: goalOnlyInputSchema,
      outputSchema: testOutputSchema,
      supportedTaskTypes: ["test-generation"],
      preferredModel: "worker",
      costTier: "low"
    },
    confidence: 0.81,
    debugLabel: "Deterministic test suggestions grounded in selected repository files",
    fallbackOutput: (input) => {
      const selectedPaths = contextPaths(input);

      return {
        suggestedTests: [
          ...(selectedPaths.length > 0
            ? [`Add focused coverage around ${selectedPaths.join(" and ")}.`]
            : []),
          "Validate schema parsing for structured workflow outputs.",
          "Validate state transitions for host-managed review and task-session workflows.",
          "Validate write and shell safety policies."
        ]
      };
    },
    outputSchema: testOutputSchema,
    prompt: (input) => [
      "Return JSON with key suggestedTests.",
      "Focus on deterministic validation ideas only.",
      "Reference concrete repository file paths from the provided context.",
      `Goal: ${input.task.goal}`,
      ...buildRepositoryContextPromptLines(input.task)
    ].join("\n"),
    risks: [],
    schemaVersion: "1.0.0",
    taskTypes: ["test-generation"]
  },
  createPatchGenerationWorkerTaskContract()
];

export const listWorkerTaskContracts = (): WorkerTaskContract[] => [
  ...contracts
];

export const getWorkerTaskContract = (
  taskType: WorkerTaskType
): WorkerTaskContract => {
  const contract = contracts.find((candidate) =>
    candidate.taskTypes.includes(taskType)
  );

  if (!contract) {
    throw new Error(`No worker task contract registered for ${taskType}.`);
  }

  return contract;
};

export const buildWorkerTaskContractResultOptions = (
  contract: WorkerTaskContract,
  input: WorkerExecutionInput
): WorkerTaskContractResultOptions => ({
  agentId: contract.agentId,
  artifacts: contract.artifacts,
  confidence: contract.confidence,
  debugLabel: contract.debugLabel,
  fallbackOutput: contract.fallbackOutput(input),
  maxStructuredAttempts: contract.maxStructuredAttempts,
  mockResponse: contract.mockResponse?.(input),
  outputSchema: contract.outputSchema,
  prompt: contract.prompt(input),
  risks: contract.risks
});
