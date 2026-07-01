import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { z } from "zod";

import {
  PatchProposalSchema,
  RepositoryContextPackSchema,
  ValidationReportSchema,
  WorkerCapabilityProfileSchema,
  type PatchProposal,
  type RepositoryContextPack
} from "@mcp-code-worker/core";

import {
  getRepositoryContextFromTask,
  type WorkerExecutionInput
} from "../workers/worker-agent.js";
import type { WorkerTaskContract } from "./worker-task-contract.js";

const patchGenerationInputSchema = z.object({
  errorLog: z.string().optional(),
  fixResult: z.unknown().optional(),
  goal: z.string().min(1),
  repositoryContext: RepositoryContextPackSchema,
  reviewResult: z.unknown().optional(),
  scope: z.string().optional(),
  validationReport: ValidationReportSchema.optional(),
  workerId: z.string().min(1),
  workerProfile: WorkerCapabilityProfileSchema.nullable().optional()
});

interface PatchContractInput {
  errorLog?: string;
  fixResult?: unknown;
  repositoryContext: RepositoryContextPack;
  reviewResult?: unknown;
  scope?: string;
  validationReport?: unknown;
  workerId?: string;
}

const toUnifiedDiffText = (lines: string[]): string => `${lines.join("\n")}\n`;

const MAX_FULL_CONTENT_FILES = 4;

const PATCH_CONTEXT_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "only",
  "real",
  "safe",
  "minimal",
  "patch",
  "propose",
  "proposal",
  "review",
  "behavior",
  "issue",
  "current",
  "repository",
  "scope",
  "worker"
]);

const PATCH_TARGET_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".java",
  ".kt",
  ".kts",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".cc",
  ".cxx",
  ".c",
  ".h",
  ".hpp",
  ".swift",
  ".scala",
  ".vue",
  ".svelte"
]);

const PATCH_TARGET_CONFIG_EXTENSIONS = new Set([
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg"
]);

const PATCH_TARGET_DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst"
]);

const emptyRepositoryContext = (): RepositoryContextPack => ({
  rootDir: "",
  files: [],
  selectedFiles: [],
  selectionReasons: [],
  requestedFiles: [],
  skippedFiles: [],
  coverageGapDetected: false,
  strictFiles: false,
  warnings: [],
  generatedAt: new Date().toISOString()
});

const summarizeUnknown = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2).slice(0, 2_000);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }

  return "";
};

const asTaskInputRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const stringFromTaskInput = (
  taskInput: Record<string, unknown>,
  key: string
): string | undefined =>
  typeof taskInput[key] === "string" ? taskInput[key] : undefined;

const getPatchContractInput = (
  input: WorkerExecutionInput
): PatchContractInput => {
  const taskInput = asTaskInputRecord(input.task.input);

  return {
    errorLog: stringFromTaskInput(taskInput, "errorLog"),
    fixResult: taskInput.fixResult,
    repositoryContext:
      getRepositoryContextFromTask(input.task) ?? emptyRepositoryContext(),
    reviewResult: taskInput.reviewResult,
    scope: input.scope ?? stringFromTaskInput(taskInput, "scope"),
    validationReport: taskInput.validationReport,
    workerId: stringFromTaskInput(taskInput, "workerId")
  };
};

const extractPatchContextTerms = (
  goal: string,
  input: PatchContractInput
): string[] => {
  const combined = [
    goal,
    input.scope,
    input.errorLog,
    summarizeUnknown(input.reviewResult),
    summarizeUnknown(input.fixResult)
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  return [
    ...new Set(
      combined
        .split(/[^a-z0-9_.-]+/u)
        .map((term) => term.trim())
        .filter(
          (term) =>
            term.length >= 3 &&
            !PATCH_CONTEXT_STOP_WORDS.has(term)
        )
    )
  ];
};

const pickPatchContextFiles = (
  repositoryContext: RepositoryContextPack,
  goal: string,
  input: PatchContractInput
): RepositoryContextPack["selectedFiles"] => {
  const fileByPath = new Map(
    repositoryContext.selectedFiles.map((file) => [file.path, file] as const)
  );
  const baseScores = new Map(
    repositoryContext.selectionReasons.map(
      (entry) => [entry.path, entry.score] as const
    )
  );
  const terms = extractPatchContextTerms(goal, input);
  const prioritizedPaths = repositoryContext.selectedFiles
    .map((file) => {
      const haystack = `${file.path}\n${file.content}`.toLowerCase();
      const termScore = terms.reduce((score, term) => {
        if (!haystack.includes(term)) {
          return score;
        }

        return score + (file.path.toLowerCase().includes(term) ? 12 : 4);
      }, 0);

      return {
        path: file.path,
        score: (baseScores.get(file.path) ?? 0) + termScore
      };
    })
    .sort((left, right) =>
      right.score - left.score || left.path.localeCompare(right.path)
    )
    .map((entry) => entry.path);
  const orderedPaths = [
    ...new Set([
      ...prioritizedPaths,
      ...repositoryContext.selectedFiles.map((file) => file.path)
    ])
  ];

  return orderedPaths
    .map((path) => fileByPath.get(path))
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
    .slice(0, MAX_FULL_CONTENT_FILES);
};

const pickPatchTargetByExtensionGroup = (
  repositoryContext: RepositoryContextPack,
  extensions: Set<string>
) =>
  repositoryContext.selectedFiles.find((file) =>
    extensions.has(extname(file.path).toLowerCase())
  );

const pickPatchTarget = (
  repositoryContext: RepositoryContextPack
) =>
  pickPatchTargetByExtensionGroup(
    repositoryContext,
    PATCH_TARGET_SOURCE_EXTENSIONS
  ) ??
  pickPatchTargetByExtensionGroup(
    repositoryContext,
    PATCH_TARGET_CONFIG_EXTENSIONS
  ) ??
  pickPatchTargetByExtensionGroup(
    repositoryContext,
    PATCH_TARGET_DOC_EXTENSIONS
  ) ??
  repositoryContext.selectedFiles[0];

const formatPatchRepositoryContext = (
  repositoryContext: RepositoryContextPack,
  goal: string,
  input: PatchContractInput
): string => {
  const target = pickPatchTarget(repositoryContext);
  const selectedPaths = repositoryContext.selectedFiles.map((file) => file.path);
  const contextFiles = pickPatchContextFiles(repositoryContext, goal, input);
  const lines = [
    `Root dir: ${repositoryContext.rootDir}`,
    repositoryContext.scope
      ? `Scope: ${repositoryContext.scope}`
      : "Scope: repository-wide",
    `Host-selected relevant files (${selectedPaths.length}):`,
    ...selectedPaths.map((path) => `- ${path}`),
    "Allowed patch files:",
    ...selectedPaths.map((path) => `- ${path}`),
    repositoryContext.warnings.length > 0
      ? `Warnings: ${repositoryContext.warnings.join(" | ")}`
      : "Warnings: none",
    repositoryContext.selectionReasons.length > 0
      ? "Host relevance ranking:"
      : "Host relevance ranking: none",
    ...repositoryContext.selectionReasons.map(
      (entry) => `- ${entry.path} (score=${entry.score}): ${entry.reason}`
    ),
    target
      ? `Primary patch target: ${target.path}`
      : "Primary patch target: none",
    target
      ? `Primary patch target full content:\n<<<FILE:${target.path}>>>\n${target.content}\n<<<END FILE>>>`
      : "Primary patch target full content: not available",
    `Full-content patch context files (${contextFiles.length}):`,
    ...contextFiles.flatMap((file) => [
      `<<<FILE:${file.path}>>>`,
      file.content,
      "<<<END FILE>>>"
    ])
  ];

  return lines.join("\n");
};

const buildExampleUnifiedDiff = (
  repositoryContext: RepositoryContextPack
): { diffText: string; path: string } => {
  const target = pickPatchTarget(repositoryContext);

  if (!target) {
    return {
      path: "README.md",
      diffText: toUnifiedDiffText([
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,1 +1,1 @@",
        "-Placeholder line",
        "+Updated placeholder line"
      ])
    };
  }

  const targetLines = target.content.replace(/\r\n/g, "\n").split("\n");
  if (targetLines[targetLines.length - 1] === "") {
    targetLines.pop();
  }
  const firstLine = targetLines[0] ?? "";

  if (!firstLine) {
    return {
      path: target.path,
      diffText: toUnifiedDiffText([
        `diff --git a/${target.path} b/${target.path}`,
        `--- a/${target.path}`,
        `+++ b/${target.path}`,
        "@@ -0,0 +1 @@",
        "+sample patch line"
      ])
    };
  }

  const contextLines = targetLines.slice(1, Math.min(targetLines.length, 4));
  const hunkLineCount = 1 + contextLines.length;
  return {
    path: target.path,
    diffText: toUnifiedDiffText([
      `diff --git a/${target.path} b/${target.path}`,
      `--- a/${target.path}`,
      `+++ b/${target.path}`,
      `@@ -1,${hunkLineCount} +1,${hunkLineCount} @@`,
      `-${firstLine}`,
      `+${firstLine} // sample patch`,
      ...contextLines.map((line) => ` ${line}`)
    ])
  };
};

const buildFallbackUnifiedDiff = (
  repositoryContext: RepositoryContextPack
): { diffText: string; path: string } => {
  const target = pickPatchTarget(repositoryContext);

  if (!target) {
    return {
      path: "README.md",
      diffText: toUnifiedDiffText([
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -0,0 +1 @@",
        "+Patch proposal requires manual repository context review."
      ])
    };
  }

  const firstLine = target.content.split(/\r?\n/u)[0] ?? "";
  if (!firstLine) {
    return {
      path: target.path,
      diffText: toUnifiedDiffText([
        `diff --git a/${target.path} b/${target.path}`,
        `--- a/${target.path}`,
        `+++ b/${target.path}`,
        "@@ -0,0 +1 @@",
        "+// Candidate patch generated for manual review."
      ])
    };
  }

  return {
    path: target.path,
    diffText: toUnifiedDiffText([
      `diff --git a/${target.path} b/${target.path}`,
      `--- a/${target.path}`,
      `+++ b/${target.path}`,
      "@@ -1,1 +1,2 @@",
      "+// Candidate patch generated for manual review.",
      ` ${firstLine}`
    ])
  };
};

export const buildFallbackPatchProposal = (
  input: {
    goal?: string;
    scope?: string;
  },
  repositoryContext: RepositoryContextPack,
  workerId?: string
): PatchProposal => {
  const patchTarget = buildFallbackUnifiedDiff(repositoryContext);
  const goal =
    input.goal ??
    "Generate a safe candidate patch proposal for manual review.";

  return PatchProposalSchema.parse({
    id: randomUUID(),
    title: `[PLACEHOLDER] ${goal}`,
    summary:
      "This is not an actionable fix. Structured patch generation failed, so the proposal is a blocked placeholder for manual review only.",
    rationale: [
      "Structured model output failed, so no trustworthy patch could be generated automatically.",
      "A human should inspect repository context, validation results, and fix guidance before drafting a real patch."
    ],
    unifiedDiff: patchTarget.diffText,
    files: [
      {
        path: patchTarget.path,
        changeType: "modify",
        summary: "Placeholder diff only; do not apply.",
        riskLevel: "medium"
      }
    ],
    risks: [
      "Placeholder proposal generated because structured model output failed.",
      "Patch is not actionable and requires manual review before any application attempt."
    ],
    validationPlan: [
      "Do not apply this placeholder patch.",
      "Regenerate or author a real patch before running deterministic validation."
    ],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-generation-worker",
      workerId,
      scope: input.scope
    }
  });
};

const buildCandidatePatchProposal = (
  goal: string,
  input: PatchContractInput
): PatchProposal => {
  const patchTarget = buildExampleUnifiedDiff(input.repositoryContext);

  return PatchProposalSchema.parse({
    id: randomUUID(),
    title: `Candidate patch for ${goal}`,
    summary: "Structured candidate patch proposal used as a schema example for model output.",
    rationale: [
      "This candidate illustrates the required PatchProposal JSON shape.",
      "A real provider response should replace this example with repository-grounded edits."
    ],
    unifiedDiff: patchTarget.diffText,
    files: [
      {
        path: patchTarget.path,
        changeType: "modify",
        summary: "Illustrative patch entry for schema guidance only.",
        riskLevel: "low"
      }
    ],
    risks: [
      "Example patch content is not evidence of a validated fix.",
      "Any real patch still requires inspection and deterministic validation."
    ],
    validationPlan: [
      "Replace this example with a repository-grounded patch proposal before apply.",
      "Run deterministic validation before and after any write-enabled apply."
    ],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-generation-worker",
      workerId: input.workerId,
      scope: input.scope
    }
  });
};

const buildPatchGenerationPrompt = (input: WorkerExecutionInput): string => {
  const patchInput = getPatchContractInput(input);
  const candidateProposal = buildCandidatePatchProposal(
    input.task.goal,
    patchInput
  );

  return [
    "Return only valid JSON matching the PatchProposal schema.",
    "Do not include markdown, explanations, reasoning text, or code fences.",
    "Use only the provided repository context.",
    "Treat the host-selected relevant files as the only allowed patch scope for this proposal.",
    "Only modify files listed under 'Allowed patch files'. Do not introduce edits for any file outside that list.",
    "If the real fix requires changes outside the allowed patch files, do not expand scope yourself.",
    "Instead, return a non-actionable placeholder proposal whose title starts with '[PLACEHOLDER]' and whose summary and rationale explicitly explain which additional files or scope would be required.",
    "Do not invent file contents, imports, functions, or surrounding lines that are not present in the provided file content.",
    "If you modify the primary patch target, ground unified diff hunk context in the exact file content provided below.",
    "The unifiedDiff string must end with a trailing newline.",
    "When modifying an existing multi-line file, include unchanged context lines in each hunk so git apply can locate the edit reliably.",
    "Do not emit a single-line @@ -1,1 +1,1 @@ hunk for a multi-line source file unless the real file truly has exactly one line.",
    "Use exact unified diff headers, exact file paths, and exact pre-change lines copied from the provided file content.",
    "Preserve blank lines exactly when writing unified diff hunks.",
    "If a removed line is truly blank, emit '-' with nothing after it. If an unchanged context line is truly blank, emit ' ' with nothing after it.",
    "Do not add spaces or tabs to otherwise blank diff lines unless those whitespace characters already exist in the source file.",
    "Use exactly these top-level keys:",
    "- id: string",
    "- title: string",
    "- summary: string",
    "- rationale: string[]",
    "- unifiedDiff: string",
    "- files: Array<{ path: string; changeType: \"add\" | \"modify\" | \"delete\"; summary: string; riskLevel: \"low\" | \"medium\" | \"high\"; beforeHash?: string; afterHash?: string }>",
    "- risks: string[]",
    "- validationPlan: string[]",
    "- generatedAt: ISO-8601 datetime string",
    "- source: { workflow: string; workerId?: string; scope?: string; taskId?: string }",
    "Do not omit any required field.",
    "Do not claim the patch has already been applied.",
    "The unifiedDiff field must contain a valid unified diff string starting with 'diff --git'.",
    "The files field must be a JSON array, not a sentence or object.",
    "The rationale, risks, and validationPlan fields must all be JSON arrays of strings.",
    `Example valid JSON shape:\n${JSON.stringify(candidateProposal, null, 2)}`,
    `Goal: ${input.task.goal}`,
    patchInput.scope ? `Scope: ${patchInput.scope}` : "Scope: repository-wide",
    patchInput.errorLog ? `Error log:\n${patchInput.errorLog}` : "Error log: not provided",
    patchInput.validationReport
      ? `Validation report:\n${JSON.stringify(patchInput.validationReport, null, 2).slice(0, 2_000)}`
      : "Validation report: not provided",
    `Review result:\n${summarizeUnknown(patchInput.reviewResult)}`,
    `Fix result:\n${summarizeUnknown(patchInput.fixResult)}`,
    `Repository context:\n${formatPatchRepositoryContext(
      patchInput.repositoryContext,
      input.task.goal,
      patchInput
    )}`
  ].join("\n\n");
};

export const createPatchGenerationWorkerTaskContract = (): WorkerTaskContract => ({
  agentId: "worker.patch-generation",
  artifacts: [],
  capability: {
    name: "patch-generation-worker",
    description: "Generates structured patch proposals for later inspection and gated apply.",
    inputSchema: patchGenerationInputSchema,
    outputSchema: PatchProposalSchema,
    supportedTaskTypes: ["patch-generation"],
    preferredModel: "worker",
    costTier: "medium"
  },
  confidence: 0.7,
  debugLabel: "Structured patch proposal grounded in host-selected files",
  fallbackOutput: (input) => {
    const patchInput = getPatchContractInput(input);

    return buildFallbackPatchProposal(
      {
        goal: input.task.goal,
        scope: patchInput.scope
      },
      patchInput.repositoryContext,
      patchInput.workerId
    );
  },
  mockResponse: (input) =>
    buildCandidatePatchProposal(input.task.goal, getPatchContractInput(input)),
  outputSchema: PatchProposalSchema,
  prompt: buildPatchGenerationPrompt,
  risks: [],
  schemaVersion: "1.0.0",
  taskTypes: ["patch-generation"]
});
