import { createHash, randomUUID } from "node:crypto";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import type {
  AgentTask,
  ExecutionContext,
  ModelConfig,
  WorkerAdmissionDecision,
  WorkerCapabilityProfile,
  WorkerCapabilityPortrait,
  WorkerInterviewDiagnostics,
  WorkerInterviewEvidence,
  WorkerInterviewPersistenceAdvice,
  WorkerEvaluationScore,
  WorkerEvaluationSuite,
  WorkerInterviewResult,
  WorkerInterviewTask,
  WorkerInterviewTaskResult,
  WorkerInterviewTaskType,
  WorkerTaskScoreCard,
  WorkflowState,
  WorkerTaskType
} from "@mcp-code-worker/core";
import {
  AgentError,
  WorkerCapabilityProfileSchema,
  resolveExecutionContext
} from "@mcp-code-worker/core";
import { ModelRouter, invokeStructured } from "@mcp-code-worker/models";

import { createInitialWorkflowState } from "./workflow-state.js";

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

interface FixtureFile {
  path: string;
  content: string;
}

const WORKER_EVALUATION_SUITE_NAME = "default-worker-onboarding-suite";
const WORKER_EVALUATION_SUITE_VERSION = "6";

const InterviewState = Annotation.Root({
  task: Annotation<WorkflowState["task"]>(),
  plan: Annotation<WorkflowState["plan"]>(),
  workerResults: Annotation<WorkflowState["workerResults"]>(),
  toolResults: Annotation<WorkflowState["toolResults"]>(),
  review: Annotation<WorkflowState["review"]>(),
  finalResult: Annotation<WorkflowState["finalResult"]>(),
  workerCapabilityProfile:
    Annotation<WorkflowState["workerCapabilityProfile"]>(),
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

const createPromptId = (
  seed: string,
  taskType: WorkerInterviewTaskType
): string =>
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

const normalizeText = (value: string): string => value.toLowerCase();

const includesAny = (value: string, expected: string[]): boolean => {
  const normalizedValue = normalizeText(value);
  return expected.some((entry) =>
    normalizedValue.includes(normalizeText(entry))
  );
};

const stringifyParsed = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

const detectTemplateLanguage = (value: string): boolean =>
  /summarize-context|draft-implementation|plan-tests|workflow|step 1|step 2|scope not provided/iu.test(
    value
  );

const detectGenericAnswer = (value: string): boolean =>
  /inspect the code|review the files|depends on context|needs more context|possible issue|check the implementation/iu.test(
    value
  );

const hasRepoPathReference = (value: string): boolean =>
  /packages\/[a-z0-9-]+\/src\/[A-Za-z0-9./-]+/iu.test(value);

const hasConcreteRiskExample = (value: string): boolean => {
  const normalizedValue = normalizeText(value);
  const hasRiskSubject =
    /ignore|non-number|unexpected input|nan|null|undefined|string|invalid/u.test(
      normalizedValue
    );
  const hasTrigger = /input|value|\[|array|when|if|given|example|trigger/u.test(
    normalizedValue
  );
  const hasOutcome =
    /return|result|sum|0|silently|instead|ambiguous|incorrect|lost|hide/u.test(
      normalizedValue
    );
  return hasRiskSubject && hasTrigger && hasOutcome;
};

const renderFixtureFiles = (files: FixtureFile[]): string[] => [
  "Repository files:",
  ...files.flatMap((file) => [
    `File: ${file.path}`,
    ...file.content.trim().split("\n")
  ])
];

const routingFixtureFiles: FixtureFile[] = [
  {
    path: "packages/runtime/src/selectWorker.ts",
    content: [
      "export function selectWorker(profile: WorkerProfile): string {",
      '  return profile.status === "not-qualified" ? "fallback-worker" : profile.workerId;',
      "}"
    ].join("\n")
  },
  {
    path: "packages/runtime/src/profileCache.ts",
    content: [
      "export function canReuseProfile(profile: WorkerProfile, modelId: string): boolean {",
      "  return profile.modelId === modelId && !profile.expired;",
      "}"
    ].join("\n")
  },
  {
    path: "packages/cli/src/index.ts",
    content: [
      "export function renderWorkerSummary(workerId: string): string {",
      "  return `worker=${workerId}`;",
      "}"
    ].join("\n")
  }
];

const scopeFixtureFiles: FixtureFile[] = [
  {
    path: "packages/id/src/generateId.ts",
    content: [
      "export function generateId(prefix: string, raw: string): string {",
      "  return `${prefix}-${raw.trim()}`;",
      "}"
    ].join("\n")
  },
  {
    path: "packages/id/src/schemaMinimum.ts",
    content: [
      "export const schemaMinimum = {",
      "  prefix: { minLength: 1 },",
      "  raw: { minLength: 1 }",
      "};"
    ].join("\n")
  },
  {
    path: "packages/id/src/index.ts",
    content: [
      'export { generateId } from "./generateId.js";',
      'export { schemaMinimum } from "./schemaMinimum.js";'
    ].join("\n")
  },
  {
    path: "packages/cli/src/index.ts",
    content: [
      "export function printHelp(): void {",
      '  process.stdout.write("help\\n");',
      "}"
    ].join("\n")
  }
];

const logFixtureFiles: FixtureFile[] = [
  {
    path: "packages/runtime/src/profileStore.ts",
    content: [
      "export interface PersistedWorkerProfile {",
      "  workerId: string;",
      "  score: number;",
      "}"
    ].join("\n")
  },
  {
    path: "packages/runtime/src/readProfile.ts",
    content: [
      "export function readProfile(row: { score: string }): PersistedWorkerProfile {",
      '  return { workerId: "fixture-worker", score: Number(row.score) };',
      "}"
    ].join("\n")
  }
];

const reviewFixtureFiles: FixtureFile[] = [
  {
    path: "packages/core/src/importXml.ts",
    content: [
      "export function importXml(node: XmlNode): ImportedNode {",
      "  return normalizeNode(node);",
      "}"
    ].join("\n")
  },
  {
    path: "packages/core/src/normalizeNode.ts",
    content: [
      "export function normalizeNode(node: XmlNode): ImportedNode {",
      "  return {",
      "    ...node,",
      "    attrs: node.attrs?.id ? node.attrs : { ...node.attrs, id: generateId(node.type) }",
      "  };",
      "}"
    ].join("\n")
  },
  {
    path: "packages/core/src/exportXml.ts",
    content: [
      "export function exportXml(node: ImportedNode): XmlNode {",
      "  return node;",
      "}"
    ].join("\n")
  }
];

const missingEvidenceFixtureFiles: FixtureFile[] = [
  {
    path: "packages/core/src/exportXml.ts",
    content: [
      "export function exportXml(node: ImportedNode): XmlNode {",
      "  return node;",
      "}"
    ].join("\n")
  },
  {
    path: "packages/core/src/renderPreview.ts",
    content: [
      "export function renderPreview(xml: string): string {",
      "  return xml.slice(0, 120);",
      "}"
    ].join("\n")
  }
];

const codeUnderstandingFixtureFiles: FixtureFile[] = [
  {
    path: "packages/math/src/sumValidated.ts",
    content: [
      "export function sumValidated(values: unknown[]): number {",
      "  return values",
      '    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))',
      "    .reduce((total, value) => total + value, 0);",
      "}"
    ].join("\n")
  }
];

const codegenFixtureFiles: FixtureFile[] = [
  {
    path: "packages/validation/src/validateScore.ts",
    content: [
      "export interface ValidationResult {",
      "  ok: boolean;",
      "  message?: string;",
      "}",
      "",
      "// TODO: implement validateScore"
    ].join("\n")
  }
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
      "Analyze the worker-routing regression using only the repository evidence below.",
      "Use exactly these keys and types:",
      "- summary: string",
      "- risks: string[]",
      "- confidence: number between 0 and 1",
      "- files: string[]",
      "Return at least one risk and at least one file from the fixture.",
      ...renderFixtureFiles(routingFixtureFiles),
      "Incident summary:",
      "- Cached worker profiles are being reused after capability drift.",
      "- A blocked worker could still be selected if cache reuse is wrong.",
      "- The answer must cite only files from the repository fixture."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.85,"files":["path.ts"]}'
  ),
  strictJsonContractLines(
    [
      "Review the release incident notes below using the repository fixture only.",
      "Use exactly these keys and types:",
      "- summary: string",
      "- risks: string[]",
      "- confidence: number between 0 and 1",
      "- files: string[]",
      "Return at least one risk and at least one file from the fixture.",
      ...renderFixtureFiles(routingFixtureFiles),
      "Incident notes:",
      "- A hotfix changed worker selection behavior.",
      "- The fallback path may reuse a stale profile without checking expiry.",
      "- Main risk: the wrong worker id can survive routing."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.78,"files":["path.ts"]}'
  ),
  strictJsonContractLines(
    [
      "Inspect the routing regression summary below using only the fixture files.",
      "Use exactly these keys and types:",
      "- summary: string",
      "- risks: string[]",
      "- confidence: number between 0 and 1",
      "- files: string[]",
      "Return at least one risk and at least one file from the fixture.",
      ...renderFixtureFiles(routingFixtureFiles),
      "Regression summary:",
      "- Worker capability profiles are reused too aggressively.",
      "- A stale cache can return an outdated worker id.",
      "- Main risk: runtime routing decisions trust the wrong profile."
    ],
    '{"summary":"...","risks":["risk 1"],"confidence":0.81,"files":["path.ts"]}'
  )
];

const scopeDisciplineVariants = [
  strictJsonContractLines(
    [
      "Review the repository task request below.",
      "Use exactly these keys and types:",
      "- allowedFiles: string[]",
      "- blockedFiles: string[]",
      "- answer: string",
      "- confidence: number between 0 and 1",
      "Do not invent files outside the request.",
      "The answer must mention at least one allowed file path.",
      ...renderFixtureFiles(scopeFixtureFiles),
      "Task request:",
      "- Scope: packages/id",
      "- Allowed files: packages/id/src/generateId.ts, packages/id/src/schemaMinimum.ts, packages/id/src/index.ts",
      "- Out-of-scope file that must be blocked: packages/cli/src/index.ts",
      "- Goal: explain which file should be inspected first for id-generation regressions."
    ],
    '{"allowedFiles":["packages/id/src/generateId.ts"],"blockedFiles":["packages/cli/src/index.ts"],"answer":"Inspect packages/id/src/generateId.ts first.","confidence":0.82}'
  ),
  strictJsonContractLines(
    [
      "Answer the scoped repository request below.",
      "Use exactly these keys and types:",
      "- allowedFiles: string[]",
      "- blockedFiles: string[]",
      "- answer: string",
      "- confidence: number between 0 and 1",
      "Do not widen the scope.",
      "The answer must cite an allowed file path verbatim.",
      ...renderFixtureFiles(scopeFixtureFiles),
      "Task request:",
      "- Scope: packages/id",
      "- Allowed files: packages/id/src/generateId.ts, packages/id/src/schemaMinimum.ts",
      "- Must block: packages/cli/src/index.ts",
      "- Goal: identify the first file to inspect for id-format regressions."
    ],
    '{"allowedFiles":["packages/id/src/generateId.ts"],"blockedFiles":["packages/cli/src/index.ts"],"answer":"Start with packages/id/src/generateId.ts because it trims and formats the id.","confidence":0.79}'
  )
];

const summarizationVariants = [
  strictJsonContractLines(
    [
      "Summarize the error log below as JSON using the repository fixture.",
      "Use exactly these keys and types:",
      "- issue: string",
      "- impact: string",
      "- nextSteps: string[]",
      "- confidence: number between 0 and 1",
      "Return at least two nextSteps.",
      "Ground the summary in the repository fixture: at least one nextSteps item must name packages/runtime/src/readProfile.ts or packages/runtime/src/profileStore.ts verbatim.",
      "Do not use generic next steps without naming the concrete fixture file to inspect or change.",
      ...renderFixtureFiles(logFixtureFiles),
      "Error log:",
      "TS2322: Type '{ score: string; }' is not assignable to type 'PersistedWorkerProfile'.",
      "  at packages/runtime/src/readProfile.ts:2:49",
      "Build failed after profile parsing changes."
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.95}'
  ),
  strictJsonContractLines(
    [
      "Convert the failure log below into JSON using the repository fixture.",
      "Use exactly these keys and types:",
      "- issue: string",
      "- impact: string",
      "- nextSteps: string[]",
      "- confidence: number between 0 and 1",
      "Return at least two nextSteps.",
      "Ground the summary in the repository fixture: at least one nextSteps item must name packages/runtime/src/readProfile.ts or packages/runtime/src/profileStore.ts verbatim.",
      "Do not use generic next steps without naming the concrete fixture file to inspect or change.",
      ...renderFixtureFiles(logFixtureFiles),
      "Failure log:",
      "TypeError: score.toFixed is not a function",
      "  at packages/runtime/src/readProfile.ts:2:49",
      "  called with persisted row data where score is still a string"
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.72}'
  ),
  strictJsonContractLines(
    [
      "Summarize the build failure below as JSON using the repository fixture.",
      "Use exactly these keys and types:",
      "- issue: string",
      "- impact: string",
      "- nextSteps: string[]",
      "- confidence: number between 0 and 1",
      "Return at least two nextSteps.",
      "Ground the summary in the repository fixture: at least one nextSteps item must name packages/runtime/src/readProfile.ts or packages/runtime/src/profileStore.ts verbatim.",
      "Do not use generic next steps without naming the concrete fixture file to inspect or change.",
      ...renderFixtureFiles(logFixtureFiles),
      "Build output:",
      "pnpm --filter @fixture/runtime build",
      "error TS2345: Argument of type '{ score: string; }' is not assignable to parameter of type 'PersistedWorkerProfile'.",
      "Compilation stopped in packages/runtime/src/readProfile.ts."
    ],
    '{"issue":"...","impact":"...","nextSteps":["step 1","step 2"],"confidence":0.88}'
  )
];

const reviewGroundingVariants = [
  strictJsonContractLines(
    [
      "Review the repository evidence below and answer whether import-time id generation is already implemented.",
      "Use exactly these keys and types:",
      "- answer: string",
      "- findings: string[]",
      "- referencedFiles: string[]",
      "- confidence: number between 0 and 1",
      "The answer must be direct, cite only fixture files, and reference at least two concrete repository paths.",
      ...renderFixtureFiles(reviewFixtureFiles),
      "Question:",
      "- Does the import path already generate missing ids before export?",
      "- Focus on import/normalize behavior and mention export only if directly relevant."
    ],
    '{"answer":"yes","findings":["..."],"referencedFiles":["path.ts"],"confidence":0.82}'
  ),
  strictJsonContractLines(
    [
      "Use the repository evidence below to review the missing-id handling behavior.",
      "Use exactly these keys and types:",
      "- answer: string",
      "- findings: string[]",
      "- referencedFiles: string[]",
      "- confidence: number between 0 and 1",
      "The answer must be direct, grounded in the fixture, and reference at least two fixture paths.",
      ...renderFixtureFiles(reviewFixtureFiles),
      "Question:",
      "- Is the id generated during import/normalization rather than waiting for export?",
      "- Keep the review grounded in the selected files only."
    ],
    '{"answer":"yes","findings":["..."],"referencedFiles":["path.ts"],"confidence":0.79}'
  )
];

const evidenceSufficiencyVariants = [
  strictJsonContractLines(
    [
      "Decide whether the repository evidence below is sufficient to answer the question.",
      "Use exactly these keys and types:",
      "- decision: string",
      "- reason: string",
      "- missingFiles: string[]",
      "- confidence: number between 0 and 1",
      "If the evidence is insufficient, say so directly and name the mandatory missing file or files.",
      "Do not pretend to know the answer from incomplete evidence.",
      "Confidence means confidence in answering the original repository question reliably, not confidence that evidence is missing.",
      "If mandatory evidence is missing, confidence must stay low because the underlying repository question cannot be answered reliably.",
      "Do not report high confidence simply because you are confident that the evidence is insufficient.",
      ...renderFixtureFiles(missingEvidenceFixtureFiles),
      "Question:",
      "- Can we conclude whether import-time id generation already exists for missing attrs.id?",
      "- Mandatory evidence is expected from import/normalize code, not export or preview helpers."
    ],
    '{"decision":"insufficient-evidence","reason":"The import/normalize path is missing.","missingFiles":["packages/core/src/importXml.ts","packages/core/src/normalizeNode.ts"],"confidence":0.18}'
  ),
  strictJsonContractLines(
    [
      "Evaluate whether the selected repository files are enough to answer the review question.",
      "Use exactly these keys and types:",
      "- decision: string",
      "- reason: string",
      "- missingFiles: string[]",
      "- confidence: number between 0 and 1",
      "If key files are missing, fail fast and list them instead of guessing.",
      "Confidence means confidence in answering the original repository question reliably, not confidence that evidence is missing.",
      "If required evidence is missing, confidence must stay low because the task answer remains uncertain.",
      "Do not use high confidence just because you are certain the selected files are insufficient.",
      ...renderFixtureFiles(missingEvidenceFixtureFiles),
      "Question:",
      "- Is the missing-id fix implemented in the import path?",
      "- Required evidence should come from the import/normalization chain."
    ],
    '{"decision":"insufficient-evidence","reason":"The selected files do not include the import path.","missingFiles":["packages/core/src/importXml.ts"],"confidence":0.22}'
  )
];

const codeUnderstandingVariants = [
  strictJsonContractLines(
    [
      "Given this TypeScript function, return only JSON.",
      "Use exactly these keys and types:",
      "- behavior: string",
      "- risk: string",
      "- confidence: number between 0 and 1",
      "Ground the answer in the fixture file by explicitly naming packages/math/src/sumValidated.ts in the behavior or risk field.",
      "Do not use vague risk labels such as low or none without naming a concrete limitation of the implementation.",
      "The risk must name a concrete failure mode, the trigger input pattern, and the incorrect or ambiguous result.",
      'Example concrete risk: packages/math/src/sumValidated.ts silently ignores ["5", NaN], so it can return 0 instead of reporting invalid input.',
      'Generic phrases such as "may hide data issues" or "unexpected results" are insufficient unless paired with a concrete input/output example.',
      ...renderFixtureFiles(codeUnderstandingFixtureFiles),
      "Explain the behavior of packages/math/src/sumValidated.ts and name one concrete risk."
    ],
    '{"behavior":"...","risk":"...","confidence":0.95}'
  ),
  strictJsonContractLines(
    [
      "Review this TypeScript helper and return only JSON.",
      "Use exactly these keys and types:",
      "- behavior: string",
      "- risk: string",
      "- confidence: number between 0 and 1",
      "Ground the answer in the fixture file by explicitly naming packages/math/src/sumValidated.ts in the behavior or risk field.",
      "Do not use vague risk labels such as low or none without naming a concrete limitation of the implementation.",
      "The risk must name a concrete failure mode, the trigger input pattern, and the incorrect or ambiguous result.",
      'Example concrete risk: packages/math/src/sumValidated.ts silently ignores ["5", NaN], so it can return 0 instead of reporting invalid input.',
      'Generic phrases such as "may hide data issues" or "unexpected results" are insufficient unless paired with a concrete input/output example.',
      ...renderFixtureFiles(codeUnderstandingFixtureFiles),
      "Focus on packages/math/src/sumValidated.ts.",
      "Describe what values are ignored and one limitation of that behavior."
    ],
    '{"behavior":"...","risk":"...","confidence":0.9}'
  ),
  strictJsonContractLines(
    [
      "Explain the TypeScript function below using only JSON.",
      "Use exactly these keys and types:",
      "- behavior: string",
      "- risk: string",
      "- confidence: number between 0 and 1",
      "Ground the answer in the fixture file by explicitly naming packages/math/src/sumValidated.ts in the behavior or risk field.",
      "Do not use vague risk labels such as low or none without naming a concrete limitation of the implementation.",
      "The risk must name a concrete failure mode, the trigger input pattern, and the incorrect or ambiguous result.",
      'Example concrete risk: packages/math/src/sumValidated.ts silently ignores ["5", NaN], so it can return 0 instead of reporting invalid input.',
      'Generic phrases such as "may hide data issues" or "unexpected results" are insufficient unless paired with a concrete input/output example.',
      ...renderFixtureFiles(codeUnderstandingFixtureFiles),
      "Answer for packages/math/src/sumValidated.ts only."
    ],
    '{"behavior":"...","risk":"...","confidence":0.83}'
  )
];

const codegenVariants = [
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      "- code: string",
      "- confidence: number between 0 and 1",
      "The code value must be strict TypeScript.",
      ...renderFixtureFiles(codegenFixtureFiles),
      "Target file: packages/validation/src/validateScore.ts",
      "It must define:",
      "export function validateScore(value: number): { ok: boolean; message?: string }",
      "The function must reject non-finite and negative numbers."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.68}'
  ),
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      "- code: string",
      "- confidence: number between 0 and 1",
      "The code value must be strict TypeScript.",
      ...renderFixtureFiles(codegenFixtureFiles),
      "Target file: packages/validation/src/validateScore.ts",
      "Generate exactly this function signature:",
      "export function validateScore(value: number): { ok: boolean; message?: string }",
      "The implementation must reject non-finite values and values below zero."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.74}'
  ),
  strictJsonContractLines(
    [
      "Use exactly these keys and types:",
      "- code: string",
      "- confidence: number between 0 and 1",
      "The code value must be strict TypeScript.",
      ...renderFixtureFiles(codegenFixtureFiles),
      "Target file: packages/validation/src/validateScore.ts",
      "Include this exact exported signature:",
      "export function validateScore(value: number): { ok: boolean; message?: string }",
      "Return ok=false for non-finite or negative input."
    ],
    '{"code":"export function validateScore(...) { ... }","confidence":0.61}'
  )
];

const confidenceCalibrationVariants = [
  strictJsonContractLines(
    [
      "Answer the underspecified question below as JSON.",
      "Use exactly these keys and types:",
      "- answer: string",
      "- confidence: number between 0 and 1",
      "- uncertaintyReason: string",
      "Keep confidence low when the prompt lacks evidence.",
      "Question: Which deployment change caused yesterday's production latency spike?"
    ],
    '{"answer":"unknown","confidence":0.1,"uncertaintyReason":"missing evidence"}'
  ),
  strictJsonContractLines(
    [
      "Return only JSON for the ambiguous question below.",
      "Use exactly these keys and types:",
      "- answer: string",
      "- confidence: number between 0 and 1",
      "- uncertaintyReason: string",
      "Keep confidence low when the prompt lacks evidence.",
      "Question: Which engineer approved the risky routing patch last week?"
    ],
    '{"answer":"unknown","confidence":0.05,"uncertaintyReason":"missing evidence"}'
  ),
  strictJsonContractLines(
    [
      "Respond in JSON to the underdetermined question below.",
      "Use exactly these keys and types:",
      "- answer: string",
      "- confidence: number between 0 and 1",
      "- uncertaintyReason: string",
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
          pickVariant(
            seed,
            "instruction-following",
            instructionFollowingVariants
          )
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
        summary:
          "packages/runtime/src/profileCache.ts can reuse a stale profile and route the wrong worker.",
        risks: ["A blocked worker may still be selected from cache reuse."],
        files: ["packages/runtime/src/profileCache.ts"],
        confidence: 0.66
      },
      mapRawOutputToTaskTypes: ["json-extraction"],
      evaluateParsed: (parsed) => {
        const value = parsed as {
          files: string[];
          risks: string[];
          summary: string;
        };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (
          !value.files.some((file) =>
            [
              "packages/runtime/src/selectWorker.ts",
              "packages/runtime/src/profileCache.ts",
              "packages/cli/src/index.ts"
            ].includes(file)
          )
        ) {
          findings.push(
            "Structured output did not preserve the cited repository files."
          );
        }
        if (
          !includesAny(value.summary, ["worker", "profile", "routing", "cache"])
        ) {
          findings.push("Structured output summary was too generic.");
        }
        if (value.risks.length === 0) {
          findings.push("Structured output omitted concrete risks.");
        }
        if (detectTemplateLanguage(rendered)) {
          findings.push(
            "Structured output fell back to template workflow language."
          );
        }
        return {
          score: findings.length === 0 ? 0.92 : 0.38,
          findings
        };
      }
    },
    {
      task: {
        id: "scope-discipline",
        title: "Scope Discipline",
        type: "scope-discipline",
        prompt: createPrompt(
          seed,
          "scope-discipline",
          pickVariant(seed, "scope-discipline", scopeDisciplineVariants)
        ),
        expectedOutputDescription:
          "Repo-grounded answer that respects the provided scope"
      },
      schema: z.object({
        allowedFiles: z.array(z.string()).min(1),
        blockedFiles: z.array(z.string()).min(1),
        answer: z.string().min(1),
        confidence: z.number().min(0).max(1)
      }),
      mockResponse: {
        allowedFiles: ["packages/id/src/generateId.ts"],
        blockedFiles: ["packages/cli/src/index.ts"],
        answer:
          "Inspect packages/id/src/generateId.ts first because it applies trim and prefix formatting directly.",
        confidence: 0.82
      },
      mapRawOutputToTaskTypes: ["review-lite", "summarization"],
      evaluateParsed: (parsed) => {
        const value = parsed as {
          allowedFiles: string[];
          answer: string;
          blockedFiles: string[];
        };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (!value.blockedFiles.includes("packages/cli/src/index.ts")) {
          findings.push("Worker did not block the out-of-scope file.");
        }
        if (!value.allowedFiles.includes("packages/id/src/generateId.ts")) {
          findings.push("Worker missed the primary in-scope file.");
        }
        if (!includesAny(value.answer, ["packages/id/src/generateId.ts"])) {
          findings.push(
            "Worker answer was not grounded in an allowed repository file."
          );
        }
        if (
          detectTemplateLanguage(rendered) ||
          detectGenericAnswer(value.answer)
        ) {
          findings.push(
            "Worker answer fell back to generic workflow language."
          );
        }
        return {
          score: findings.length === 0 ? 0.94 : 0.28,
          findings
        };
      }
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
        issue:
          "packages/runtime/src/readProfile.ts still treats score as a string during profile parsing.",
        impact: "Profile loading fails and runtime builds stop.",
        nextSteps: [
          "Update packages/runtime/src/readProfile.ts to normalize score as a number.",
          "Verify PersistedWorkerProfile usage in packages/runtime/src/profileStore.ts."
        ],
        confidence: 0.72
      },
      mapRawOutputToTaskTypes: ["summarization", "log-analysis"],
      evaluateParsed: (parsed) => {
        const value = parsed as {
          issue: string;
          nextSteps: string[];
        };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (value.nextSteps.length < 2) {
          findings.push("Summarization did not provide enough next steps.");
        }
        if (!includesAny(value.issue, ["score", "profile", "build", "type"])) {
          findings.push("Summarization issue description was too generic.");
        }
        if (
          !value.nextSteps.some((step) =>
            includesAny(step, [
              "packages/runtime/src/readProfile.ts",
              "packages/runtime/src/profileStore.ts"
            ])
          )
        ) {
          findings.push(
            "Summarization did not stay grounded in the cited repository files."
          );
        }
        if (detectTemplateLanguage(rendered)) {
          findings.push(
            "Summarization fell back to template workflow language."
          );
        }
        return {
          score: findings.length === 0 ? 0.9 : 0.42,
          findings
        };
      }
    },
    {
      task: {
        id: "review-grounding",
        title: "Review Grounding",
        type: "review-grounding",
        prompt: createPrompt(
          seed,
          "review-grounding",
          pickVariant(seed, "review-grounding", reviewGroundingVariants)
        ),
        expectedOutputDescription:
          "Direct evidence-linked repository review answer"
      },
      schema: z.object({
        answer: z.string().min(1),
        findings: z.array(z.string()).min(2),
        referencedFiles: z.array(z.string()).min(2),
        confidence: z.number().min(0).max(1)
      }),
      mockResponse: {
        answer:
          "Yes. The import path normalizes missing ids before export is involved.",
        findings: [
          "packages/core/src/importXml.ts delegates imported nodes into normalizeNode.",
          "packages/core/src/normalizeNode.ts adds attrs.id with generateId(node.type) when id is missing."
        ],
        referencedFiles: [
          "packages/core/src/importXml.ts",
          "packages/core/src/normalizeNode.ts"
        ],
        confidence: 0.83
      },
      mapRawOutputToTaskTypes: ["review-lite"],
      evaluateParsed: (parsed) => {
        const value = parsed as {
          answer: string;
          findings: string[];
          referencedFiles: string[];
        };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (!includesAny(value.answer, ["yes", "import", "normalize"])) {
          findings.push(
            "Review answer was not direct enough about the import path outcome."
          );
        }
        if (value.findings.length < 2) {
          findings.push(
            "Review answer did not provide enough concrete findings."
          );
        }
        if (
          !value.referencedFiles.includes("packages/core/src/importXml.ts") ||
          !value.referencedFiles.includes("packages/core/src/normalizeNode.ts")
        ) {
          findings.push(
            "Review answer did not cite the mandatory repository files."
          );
        }
        if (!hasRepoPathReference(rendered)) {
          findings.push(
            "Review answer was not grounded in concrete repository paths."
          );
        }
        if (detectTemplateLanguage(rendered) || detectGenericAnswer(rendered)) {
          findings.push(
            "Review answer fell back to generic workflow language."
          );
        }
        return {
          score: findings.length === 0 ? 0.93 : 0.26,
          findings
        };
      }
    },
    {
      task: {
        id: "evidence-sufficiency",
        title: "Evidence Sufficiency",
        type: "evidence-sufficiency",
        prompt: createPrompt(
          seed,
          "evidence-sufficiency",
          pickVariant(seed, "evidence-sufficiency", evidenceSufficiencyVariants)
        ),
        expectedOutputDescription:
          "Fail-fast decision when mandatory evidence is missing"
      },
      schema: z.object({
        decision: z.string().min(1),
        reason: z.string().min(1),
        missingFiles: z.array(z.string()),
        confidence: z.number().min(0).max(1)
      }),
      mockResponse: {
        decision: "insufficient-evidence",
        reason:
          "The selected files do not include the import/normalization chain.",
        missingFiles: [
          "packages/core/src/importXml.ts",
          "packages/core/src/normalizeNode.ts"
        ],
        confidence: 0.18
      },
      mapRawOutputToTaskTypes: ["review-lite", "summarization"],
      evaluateParsed: (parsed) => {
        const value = parsed as {
          confidence: number;
          decision: string;
          missingFiles: string[];
          reason: string;
        };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (
          !includesAny(value.decision, [
            "insufficient-evidence",
            "insufficient"
          ])
        ) {
          findings.push(
            "Worker did not fail fast when mandatory evidence was missing."
          );
        }
        if (
          value.missingFiles.length === 0 ||
          !value.missingFiles.some((file) =>
            [
              "packages/core/src/importXml.ts",
              "packages/core/src/normalizeNode.ts"
            ].includes(file)
          )
        ) {
          findings.push("Worker did not name the mandatory missing files.");
        }
        if (
          !includesAny(value.reason, [
            "missing",
            "import",
            "normalize",
            "evidence"
          ])
        ) {
          findings.push(
            "Worker did not explain why the evidence was insufficient."
          );
        }
        if (
          includesAny(value.reason, [
            "probably",
            "looks fine",
            "should be present",
            "seems implemented"
          ])
        ) {
          findings.push(
            "Worker guessed instead of refusing on insufficient evidence."
          );
        }
        if (value.confidence > 0.45) {
          findings.push(
            "Worker reported too much confidence on insufficient evidence."
          );
        }
        if (detectTemplateLanguage(rendered) || detectGenericAnswer(rendered)) {
          findings.push(
            "Worker used generic fallback language instead of a fail-fast answer."
          );
        }
        return {
          score: findings.length === 0 ? 0.95 : 0.18,
          findings
        };
      }
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
        behavior:
          "packages/math/src/sumValidated.ts filters to finite numbers and returns their sum.",
        risk: "Non-number values are silently ignored, which can hide unexpected input problems.",
        confidence: 0.7
      },
      mapRawOutputToTaskTypes: [
        "review-lite",
        "risk-analysis",
        "code-understanding"
      ],
      evaluateParsed: (parsed) => {
        const value = parsed as { behavior: string; risk: string };
        const findings: string[] = [];
        const rendered = stringifyParsed(parsed);
        if (!includesAny(value.behavior, ["sum", "finite", "filter"])) {
          findings.push(
            "Code understanding missed the concrete behavior of the function."
          );
        }
        if (!hasConcreteRiskExample(value.risk)) {
          findings.push("Code understanding risk was too generic.");
        }
        if (!hasRepoPathReference(rendered)) {
          findings.push(
            "Code understanding answer was not grounded in the fixture file."
          );
        }
        if (detectTemplateLanguage(rendered) || detectGenericAnswer(rendered)) {
          findings.push(
            "Code understanding answer fell back to generic workflow language."
          );
        }
        return {
          score: findings.length === 0 ? 0.88 : 0.44,
          findings
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
          "  if (!Number.isFinite(value)) {",
          '    return { ok: false, message: "Value must be finite." };',
          "  }",
          "  if (value < 0) {",
          '    return { ok: false, message: "Value must not be negative." };',
          "  }",
          "  return { ok: true };",
          "}"
        ].join("\n"),
        confidence: 0.68
      },
      mapRawOutputToTaskTypes: ["codegen", "validation-fix", "test-generation"],
      evaluateParsed: (parsed) => {
        const code = (parsed as { code: string }).code;
        const findings: string[] = [];

        if (code.includes("any")) {
          findings.push("Generated code uses any.");
        }
        if (!code.includes("export function validateScore")) {
          findings.push("Expected function name was not generated.");
        }
        if (!code.includes("Number.isFinite")) {
          findings.push("Generated code did not reject non-finite input.");
        }
        if (!code.includes("value < 0")) {
          findings.push("Generated code did not reject negative input.");
        }
        if (detectTemplateLanguage(code)) {
          findings.push(
            "Generated code fell back to template workflow language."
          );
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
      findings: [
        `Attempt 1: provider invocation failed: ${mockResponse.message}`
      ],
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
      findings:
        invocation.errors.length > 0
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
  "Confirm workerModel.apiKey is persisted in config.json before retrying.",
  "Run a direct provider health check before retrying the interview.",
  "Re-run `cw worker interview --save` after connectivity is stable."
];

const repoGroundedTaskIds = new Set<WorkerInterviewTaskType>([
  "structured-output",
  "scope-discipline",
  "summarization",
  "review-grounding",
  "evidence-sufficiency",
  "code-understanding",
  "codegen"
]);

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
  const scoreByType = new Map(
    taskResults.map((result) => [result.type, result.score])
  );
  const interviewDiagnostics = buildInterviewDiagnostics(taskResults);
  const instructionFollowing = scoreByType.get("instruction-following") ?? 0;
  const scopeDiscipline = scoreByType.get("scope-discipline") ?? 0;
  const summarization = scoreByType.get("summarization") ?? 0;
  const reviewGrounding = scoreByType.get("review-grounding") ?? 0;
  const evidenceSufficiency = scoreByType.get("evidence-sufficiency") ?? 0;
  const codeUnderstanding = scoreByType.get("code-understanding") ?? 0;
  const confidenceCalibration = scoreByType.get("confidence-calibration") ?? 0;
  const structuredOutput = average([
    scoreByType.get("structured-output") ?? 0,
    scoreByType.get("structured-output") ?? 0,
    scopeDiscipline
  ]);
  const reasoning = average([
    scopeDiscipline,
    summarization,
    reviewGrounding,
    evidenceSufficiency,
    codeUnderstanding
  ]);
  const codeQuality = scoreByType.get("codegen") ?? 0;
  const reliability = average(taskResults.map((result) => result.score));
  const score: WorkerEvaluationScore = {
    instructionFollowing,
    structuredOutput,
    reasoning,
    codeQuality,
    domainKnowledge: codeUnderstanding,
    reliability
  };

  const portrait: WorkerCapabilityPortrait = {
    scopeDiscipline,
    repoGrounding: average([
      structuredOutput,
      scopeDiscipline,
      summarization,
      reviewGrounding,
      evidenceSufficiency,
      codeUnderstanding
    ]),
    answerDirectness: average([
      instructionFollowing,
      scopeDiscipline,
      summarization,
      reviewGrounding,
      evidenceSufficiency
    ]),
    codeUnderstanding: average([codeUnderstanding, reviewGrounding]),
    fixPlanning: average([
      summarization,
      reviewGrounding,
      evidenceSufficiency,
      scopeDiscipline,
      codeQuality
    ]),
    implementationPlanning: average([
      codeQuality,
      instructionFollowing,
      structuredOutput
    ]),
    consistency: average([
      instructionFollowing,
      structuredOutput,
      confidenceCalibration,
      reliability
    ])
  };

  const taskScores: WorkerTaskScoreCard = {
    summarization: average([
      structuredOutput,
      summarization,
      evidenceSufficiency,
      evidenceSufficiency,
      portrait.answerDirectness
    ]),
    codeUnderstanding: average([
      codeUnderstanding,
      portrait.codeUnderstanding,
      portrait.repoGrounding
    ]),
    riskAnalysis: average([
      scopeDiscipline,
      reviewGrounding,
      evidenceSufficiency,
      codeUnderstanding,
      portrait.repoGrounding,
      portrait.answerDirectness
    ]),
    reviewLite: average([
      scopeDiscipline,
      reviewGrounding,
      reviewGrounding,
      evidenceSufficiency,
      evidenceSufficiency,
      portrait.repoGrounding,
      portrait.answerDirectness,
      codeUnderstanding
    ]),
    codegen: average([
      codeQuality,
      portrait.implementationPlanning,
      instructionFollowing
    ]),
    patchGeneration: average([
      codeQuality,
      portrait.fixPlanning,
      scopeDiscipline,
      reliability
    ]),
    testGeneration: average([
      codeQuality,
      portrait.repoGrounding,
      portrait.implementationPlanning
    ]),
    validationFix: average([
      codeQuality,
      portrait.fixPlanning,
      portrait.implementationPlanning,
      instructionFollowing
    ]),
    logAnalysis: average([
      summarization,
      evidenceSufficiency,
      structuredOutput,
      portrait.fixPlanning
    ]),
    jsonExtraction: average([
      structuredOutput,
      portrait.repoGrounding,
      instructionFollowing
    ]),
    docGeneration: average([
      summarization,
      structuredOutput,
      portrait.repoGrounding,
      portrait.answerDirectness
    ])
  };

  const evidence: WorkerInterviewEvidence = {
    failedCases: taskResults
      .filter((result) => !result.passed)
      .map((result) => result.taskId),
    repoGroundedCases: runtimeTasks
      .map((runtimeTask) => runtimeTask.task)
      .filter((task) => repoGroundedTaskIds.has(task.type))
      .map((task) => task.id),
    fallbackPatternCases: taskResults
      .filter((result) =>
        detectTemplateLanguage(stringifyParsed(result.rawOutput))
      )
      .map((result) => result.taskId),
    genericAnswerCases: taskResults
      .filter((result) =>
        result.findings.some((finding) =>
          /too generic|not grounded|template workflow language|did not answer|fell back|did not fail fast|insufficient evidence|guessed instead of refusing|mandatory evidence/iu.test(
            finding
          )
        )
      )
      .map((result) => result.taskId)
  };

  const supported = new Set<WorkerTaskType>();

  if (
    taskScores.summarization >= 0.72 &&
    scopeDiscipline >= 0.72 &&
    evidenceSufficiency >= 0.72 &&
    portrait.repoGrounding >= 0.68
  ) {
    supported.add("summarization");
    supported.add("log-analysis");
    supported.add("json-extraction");
    supported.add("doc-generation");
  }
  if (
    reviewGrounding >= 0.72 &&
    evidenceSufficiency >= 0.72 &&
    codeUnderstanding >= 0.65
  ) {
    supported.add("review-lite");
    supported.add("risk-analysis");
  }
  if (taskScores.codeUnderstanding >= 0.72 && codeUnderstanding >= 0.68) {
    supported.add("code-understanding");
  }
  if (
    taskScores.codegen >= 0.78 &&
    codeQuality >= 0.75 &&
    instructionFollowing >= 0.7
  ) {
    supported.add("codegen");
    supported.add("validation-fix");
    supported.add("test-generation");
  }

  const allowPatchGeneration =
    supported.has("codegen") &&
    codeQuality >= 0.82 &&
    score.reliability >= 0.8;

  if (allowPatchGeneration) {
    supported.add("patch-generation");
  }

  const interviewQualifiedTaskTypes: WorkerTaskType[] = [
    "summarization",
    "code-understanding",
    "review-lite",
    "risk-analysis",
    "codegen",
    "patch-generation",
    "test-generation",
    "validation-fix",
    "log-analysis",
    "json-extraction",
    "doc-generation"
  ];

  const unsupportedTaskTypes = Array.from(
    interviewQualifiedTaskTypes.filter((taskType) => !supported.has(taskType))
  );

  const warnings = taskResults
    .filter((result) => !result.passed || result.findings.length > 0)
    .flatMap((result) =>
      result.findings.map((finding) => `${result.type}: ${finding}`)
    );

  if (interviewDiagnostics.outcome === "provider-error") {
    warnings.push(
      "Interview hit provider invocation failures. Do not persist this profile until provider access is verified."
    );
  }

  const risks = [...warnings];

  const blockingReasons: string[] = [];
  if (interviewDiagnostics.providerInvocationFailures > 0) {
    blockingReasons.push("Provider invocation failed during the interview.");
  }
  if (instructionFollowing < 0.7) {
    blockingReasons.push(
      "Instruction following is below the admission threshold."
    );
  }
  if (structuredOutput < 0.7) {
    blockingReasons.push("Structured output is below the admission threshold.");
  }
  if (scopeDiscipline < 0.72) {
    blockingReasons.push("Scope discipline is below the admission threshold.");
  }
  if (evidence.fallbackPatternCases.length > 0) {
    blockingReasons.push(
      "Template workflow fallback was detected in interview output."
    );
  }
  if (supported.size === 0) {
    blockingReasons.push(
      "No worker task type cleared the minimum support bar."
    );
  }

  const admission: WorkerAdmissionDecision = {
    passed: blockingReasons.length === 0,
    blockingReasons
  };

  const status = !admission.passed ||
      taskScores.codegen < 0.78 ||
        taskScores.reviewLite < 0.76 ||
        taskScores.riskAnalysis < 0.76 ||
        taskScores.codeUnderstanding < 0.74 ||
        score.reliability < 0.78 ||
        evidence.genericAnswerCases.length > 0
      ? "not-qualified"
      : "qualified";

  const knownFailureModes = Array.from(
    new Set(taskResults.flatMap((result) => result.findings))
  ).slice(0, 8);

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
        status === "qualified"
          ? score.reliability >= 0.9
            ? "high"
            : "medium"
          : "low",
      requiresHostReview: status !== "qualified" || score.reliability < 0.85,
      allowCodegen: supported.has("codegen"),
      allowPatchGeneration,
      allowDomainTasks: status === "qualified" && score.domainKnowledge >= 0.75
    },
    evaluatedAt: new Date().toISOString(),
    expiresAt: addDays(new Date().toISOString(), 30),
    suiteName: WORKER_EVALUATION_SUITE_NAME,
    suiteVersion: WORKER_EVALUATION_SUITE_VERSION,
    evaluationSummary: {
      suiteName: WORKER_EVALUATION_SUITE_NAME,
      suiteVersion: WORKER_EVALUATION_SUITE_VERSION,
      sampleCount: taskResults.length,
      passedCount: taskResults.filter((result) => result.passed).length,
      failedCount: taskResults.filter((result) => !result.passed).length,
      confidenceBand:
        reliability >= 0.85 ? "high" : reliability >= 0.65 ? "medium" : "low",
      knownFailureModes
    },
    interviewDiagnostics,
    admission,
    portrait,
    taskScores,
    evidence
  };

  if (!admission.passed) {
    profile.warnings.push(
      ...admission.blockingReasons.map((reason) => `admission: ${reason}`)
    );
    profile.risks.push(
      ...admission.blockingReasons.map((reason) => `admission: ${reason}`)
    );
  }

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
  const context = input.context ?? (await resolveExecutionContext());
  const modelConfig = input.modelConfig ?? context.workerModel;
  const workerId = input.workerId;

  if (!workerId) {
    throw new AgentError(
      "WORKER_ID_REQUIRED",
      "Worker interview requires an explicit workerId."
    );
  }
  const router = new ModelRouter(modelConfig);
  const runtimeTasks = buildInterviewTasks({
    modelConfig,
    workerId
  });
  const task: AgentTask = {
    id: randomUUID(),
    goal: `Evaluate worker onboarding capability for ${workerId}`,
    constraints: [
      "Assess instruction following, structured output, scope discipline, summarization, evidence-linked review grounding, insufficient-evidence refusal, code understanding, code generation, and confidence calibration.",
      "Warn when the worker should be not-qualified."
    ],
    assignedRole: "reviewer",
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
        profile.status === "qualified"
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
