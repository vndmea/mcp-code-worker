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
  });
});
