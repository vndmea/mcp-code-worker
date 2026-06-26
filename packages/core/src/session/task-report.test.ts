import { describe, expect, it } from "vitest";

import { renderTaskSessionReport } from "@agent-orchestrator/core";

describe("task session report", () => {
  it("renders a readable markdown summary", () => {
    const report = renderTaskSessionReport({
      session: {
        taskId: "task-1",
        goal: "Review packages/core",
        requireProfile: false,
        status: "completed",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:10:00.000Z",
        steps: [
          {
            id: "review",
            name: "Repository review",
            status: "success",
            warnings: [],
            errors: []
          }
        ],
        artifacts: {},
        warnings: [],
        errors: [],
        metadata: {}
      },
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
      }
    });

    expect(report).toContain("# Task Session Report");
    expect(report).toContain("Task ID: task-1");
    expect(report).toContain("Validation passed across 1 check(s).");
    expect(report).toContain("No recovery guidance recorded.");
  });

  it("renders recovery guidance when validation fails after patch apply", () => {
    const report = renderTaskSessionReport({
      session: {
        taskId: "task-2",
        goal: "Apply patch",
        requireProfile: false,
        status: "needs-review",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:10:00.000Z",
        steps: [],
        artifacts: {},
        warnings: [],
        errors: [],
        metadata: {}
      },
      patchApplyResult: {
        mode: "execute",
        applied: true,
        patchId: "patch-1",
        touchedFiles: ["src/demo.ts"],
        inspection: {
          ok: true,
          files: [],
          blockedReasons: [],
          warnings: [],
          stats: {
            filesChanged: 1,
            additions: 1,
            deletions: 0
          }
        },
        recovery: {
          validationFailed: true,
          touchedFiles: ["src/demo.ts"],
          failedChecks: ["lint"],
          preApplyDirty: false,
          dirtyFilesBeforeApply: [],
          safeToRunRollbackCommands: true,
          rollbackCommands: ["git restore --worktree -- src/demo.ts"],
          rollbackActions: [
            {
              command: "git",
              args: ["restore", "--worktree", "--", "src/demo.ts"]
            }
          ],
          manualRecoveryGuide: [
            "Review failed validation checks: lint.",
            "Rerun deterministic validation after restoring the touched files."
          ]
        },
        warnings: ["Patch applied but validation failed; manual review required."],
        errors: []
      },
      validationReport: {
        checks: [
          {
            name: "lint",
            command: "pnpm lint",
            status: "failure"
          }
        ],
        ok: false,
        warnings: []
      }
    });

    expect(report).toContain("Recovery Guidance");
    expect(report).toContain("git restore --worktree -- src/demo.ts");
    expect(report).toContain(
      "Patch applied but validation failed; use the recovery guidance and rerun validation."
    );
  });
});
