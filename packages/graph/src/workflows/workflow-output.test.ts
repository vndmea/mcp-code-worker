import { describe, expect, it } from "vitest";

import {
  formatPatchProposalWorkflowOutput,
  formatTaskSessionWorkflowOutput
} from "./workflow-output.js";
import type { TaskSessionWorkflowOutput } from "./task-session-workflow.js";

describe("formatTaskSessionWorkflowOutput", () => {
  it("includes resolved local client details in summary mode", () => {
    const summary = formatTaskSessionWorkflowOutput({
      localClientRuntime: {
        configuredCommand: "node",
        resolvedCommand: "C:/Program Files/nodejs/node.exe",
        resolvedPath: "C:/Program Files/nodejs/node.exe",
        source: "configured"
      },
      mode: "dry-run",
      nextRecommendedActions: [],
      persistence: {
        artifactRegistryComplete: false,
        artifactsReadable: false,
        reportRegistered: false,
        resumable: false,
        sessionPersisted: false,
        storageKind: "temporary"
      },
      readinessSummary: "Temporary result only.",
      report: "report",
      repositoryWriteMode: "dry-run",
      rootDir: "/tmp/repo",
      session: {
        taskId: "task-1",
        goal: "Review packages/core",
        scope: "packages/core",
        workerId: "mock:worker",
        requireProfile: false,
        status: "completed",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
        steps: [],
        artifacts: {},
        warnings: [],
        errors: [],
        metadata: {}
      },
      sessionPath: "/tmp/session.json",
      sessionWriteMode: "dry-run",
      workerId: "mock:worker",
      workspaceBinding: {
        callerWorkingDirectory: "/tmp/repo",
        matchesCallerWorkingDirectory: true,
        rootDir: "/tmp/repo",
        switchedFrom: undefined
      }
    });

    expect(summary).toMatchObject({
      humanSummary: "Review completed and the task is complete.",
      localClientRuntime: {
        configuredCommand: "node",
        resolvedCommand: "C:/Program Files/nodejs/node.exe",
        source: "configured"
      }
    });
  });

  it("surfaces denied patch reasons at the summary top level", () => {
    const summary = formatPatchProposalWorkflowOutput({
      proposal: {
        id: "patch-1",
        title: "[PLACEHOLDER] blocked",
        summary: "placeholder",
        rationale: [],
        unifiedDiff: "diff --git a/a b/a",
        files: [],
        risks: [],
        validationPlan: [],
        generatedAt: "2026-06-29T00:00:00.000Z",
        source: {
          workflow: "patch-proposal-workflow",
          workerId: "mock:worker",
          scope: "packages/core"
        }
      },
      inspection: {
        ok: false,
        files: [],
        blockedReasons: [
          "Worker mock:worker is not allowed to generate patch proposals.",
          "Patch proposal is a fallback placeholder and must not be applied."
        ],
        warnings: [],
        stats: {
          filesChanged: 0,
          additions: 0,
          deletions: 0
        }
      },
      semanticValidation: {
        coverageGapDetected: false,
        genericFallbackDetected: false,
        issues: [
          {
            reason:
              "Patch proposal is a non-actionable placeholder and requires host takeover or more context.",
            stage: "patch-placeholder",
            status: "blocked"
          }
        ],
        mentionedFiles: [],
        missingRequestedFiles: [],
        resultStatus: "blocked",
        skippedFiles: [],
        templateFallbackDetected: false
      },
      warnings: [
        "Worker mock:worker is not allowed to generate patch proposals."
      ]
    });

    expect(summary).toMatchObject({
      proposalState: "placeholder",
      placeholder: true,
      deniedReason: "Worker mock:worker is not allowed to generate patch proposals.",
      deniedReasons: [
        "Worker mock:worker is not allowed to generate patch proposals.",
        "Patch proposal is a fallback placeholder and must not be applied."
      ],
      humanSummary:
        "Patch proposal is a placeholder only and must not be applied: Worker mock:worker is not allowed to generate patch proposals."
    });
  });

  it("builds a stronger task outcome summary when patch inspection blocks apply", () => {
    const summary = formatTaskSessionWorkflowOutput({
      mode: "dry-run",
      nextRecommendedActions: [],
      patchInspection: {
        ok: false,
        files: [],
        blockedReasons: ["Patch touches denied path tmp/secret.txt"],
        warnings: [],
        stats: {
          filesChanged: 1,
          additions: 1,
          deletions: 0
        }
      },
      patchProposal: {
        id: "patch-2",
        title: "Adjust task output",
        summary: "Update task output wording.",
        rationale: [],
        unifiedDiff: "diff --git a/a b/a",
        files: [],
        risks: [],
        validationPlan: [],
        generatedAt: "2026-06-29T00:00:00.000Z",
        source: {
          workflow: "patch-proposal-workflow",
          workerId: "mock:worker",
          scope: "packages/core"
        }
      },
      persistence: {
        artifactRegistryComplete: false,
        artifactsReadable: false,
        reportRegistered: false,
        resumable: false,
        sessionPersisted: false,
        storageKind: "temporary"
      },
      readinessSummary: "Worker is ready.",
      report: "report",
      repositoryWriteMode: "dry-run",
      reviewResult: {
        accepted: true,
        reviewSummary: {
          summary: "Review passed.",
          architectureImpact: "low",
          mustFixItems: [],
          shouldFixItems: [],
          missingTests: [],
          riskLevel: "low"
        }
      } as unknown as TaskSessionWorkflowOutput["reviewResult"],
      rootDir: "/tmp/repo",
      session: {
        taskId: "task-2",
        goal: "Review and propose patch",
        scope: "packages/core",
        workerId: "mock:worker",
        requireProfile: false,
        status: "needs-review",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
        steps: [],
        artifacts: {},
        warnings: [],
        errors: [],
        metadata: {}
      },
      sessionPath: "/tmp/session.json",
      sessionWriteMode: "dry-run",
      validationReport: {
        checks: [
          {
            name: "typecheck",
            command: "pnpm typecheck",
            status: "success"
          }
        ],
        ok: true,
        warnings: []
      },
      workerId: "mock:worker",
      workspaceBinding: {
        callerWorkingDirectory: "/tmp/repo",
        matchesCallerWorkingDirectory: true,
        rootDir: "/tmp/repo",
        switchedFrom: undefined
      }
    });

    expect(summary).toMatchObject({
      humanSummary:
        "Review and validation succeeded, but patch inspection blocked the proposal: Patch touches denied path tmp/secret.txt. No repository writes were applied. The task remains needs-review.",
      outcomeCode: "review-passed-patch-blocked",
      outcomeSummary:
        "review=passed | validation=passed | patch=blocked | apply=skipped",
      patch: {
        proposalState: "blocked"
      }
    });
  });
});
