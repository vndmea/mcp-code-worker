import { describe, expect, it } from "vitest";

import type {
  AgentResult,
  RepositoryContextPack
} from "@mcp-code-worker/core";

import { runHostSemanticValidation } from "./host-semantic-validator.js";

const createRepositoryContext = (
  selectedPaths: string[],
  overrides: Partial<RepositoryContextPack> = {}
): RepositoryContextPack => ({
  rootDir: "E:/repo",
  files: selectedPaths.map((path) => ({
    path,
    reason: "explicit",
    selected: true,
    sizeBytes: 10
  })),
  selectedFiles: selectedPaths.map((path) => ({
    path,
    content: `content for ${path}`,
    truncated: false,
    sizeBytes: 10
  })),
  selectionReasons: [],
  requestedFiles: selectedPaths,
  skippedFiles: [],
  coverageGapDetected: false,
  strictFiles: true,
  warnings: [],
  generatedAt: new Date().toISOString(),
  ...overrides
});

const createWorkerResult = (output: unknown): AgentResult => ({
  taskId: "task-1",
  agentId: "worker.review",
  role: "worker",
  status: "success",
  output,
  confidence: 0.8,
  risks: [],
  artifacts: [],
  metadata: {
    structuredOutputOk: true
  }
});

describe("host semantic validator registry", () => {
  it("passes a concrete review answer grounded in selected files", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "review-lite",
      workerResult: createWorkerResult({
        answer: `${selectedPath} is complete for this narrow review.`,
        findings: [`${selectedPath} keeps id generation deterministic.`],
        referencedFiles: [selectedPath]
      })
    });

    expect(result.issues).toEqual([]);
    expect(result.mentionedFiles).toEqual([selectedPath]);
  });

  it("rejects review references outside the selected repository context", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "review-lite",
      workerResult: createWorkerResult({
        answer: `${selectedPath} is partial until another file is checked.`,
        findings: [`${selectedPath} cites the selected context.`],
        referencedFiles: [selectedPath, "packages/core/src/other.ts"]
      })
    });

    expect(result.issues.map((issue) => issue.stage)).toContain(
      "review-file-reference-out-of-scope"
    );
  });

  it("rejects review findings that omit selected file citations", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "review-lite",
      workerResult: createWorkerResult({
        answer: `${selectedPath} is partial.`,
        findings: ["The implementation needs a more specific citation."],
        referencedFiles: [selectedPath]
      })
    });

    expect(result.issues.map((issue) => issue.stage)).toContain(
      "review-findings-missing-file-citations"
    );
  });

  it("rejects review output with no direct answer field", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "review-lite",
      workerResult: createWorkerResult({
        findings: [`${selectedPath} cites the selected context.`],
        referencedFiles: [selectedPath]
      })
    });

    expect(result.issues.map((issue) => issue.stage)).toContain(
      "review-answer-missing"
    );
  });

  it("reports missing requested files before worker execution semantics", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const missingPath = "packages/core/src/missing.ts";
    const result = runHostSemanticValidation({
      executionState: "blocked_by_policy",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath, missingPath],
      taskType: "review-lite",
      workerResult: null
    });

    expect(result.missingRequestedFiles).toEqual([missingPath]);
    expect(result.resultStatus).toBe("needs_more_context");
    expect(result.issues.map((issue) => issue.stage)).toContain(
      "missing-requested-files"
    );
  });

  it("rejects fabricated validation pass claims", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "log-analysis",
      validationReport: {
        ok: false,
        warnings: [],
        checks: [
          {
            name: "test",
            command: "pnpm test",
            status: "dry-run"
          }
        ]
      },
      workerResult: createWorkerResult({
        brief: `${selectedPath} looks fine and tests passed.`
      })
    });

    expect(result.resultStatus).toBe("invalid_output");
    expect(result.issues.map((issue) => issue.stage)).toContain(
      "validation-claim-unsupported"
    );
  });

  it("rejects patch proposals outside the host-selected files", () => {
    const selectedPath = "packages/core/src/generateId.ts";
    const outOfContextPath = "packages/core/src/other.ts";
    const result = runHostSemanticValidation({
      executionState: "executed",
      repositoryContext: createRepositoryContext([selectedPath]),
      requestedFiles: [selectedPath],
      taskType: "patch-generation",
      patchProposal: {
        id: "patch-1",
        title: "Patch another file",
        summary: "Touches an out-of-context file.",
        rationale: ["Used to verify semantic validation."],
        unifiedDiff: [
          `diff --git a/${outOfContextPath} b/${outOfContextPath}`,
          `--- a/${outOfContextPath}`,
          `+++ b/${outOfContextPath}`,
          "@@ -1,1 +1,1 @@",
          "-old",
          "+new"
        ].join("\n"),
        files: [
          {
            path: outOfContextPath,
            changeType: "modify",
            summary: "Out of context.",
            riskLevel: "medium"
          }
        ],
        risks: [],
        validationPlan: ["Run tests"],
        generatedAt: new Date().toISOString(),
        source: {
          workflow: "patch-generation-worker"
        }
      },
      patchInspection: {
        ok: true,
        files: [
          {
            path: outOfContextPath,
            changeType: "modify",
            summary: "Out of context.",
            riskLevel: "medium"
          }
        ],
        blockedReasons: [],
        warnings: [],
        stats: {
          filesChanged: 1,
          additions: 1,
          deletions: 1
        }
      },
      workerResult: null
    });

    expect(result.resultStatus).toBe("blocked");
    expect(result.issues.map((issue) => issue.stage)).toContain(
      "patch-file-out-of-context"
    );
  });
});
