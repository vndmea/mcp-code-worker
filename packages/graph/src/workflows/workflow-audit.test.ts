import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createExecutionContextFromEnv, listAuditEvents } from "@agent-orchestrator/core";
import { runLeaderWorkerWorkflow } from "@agent-orchestrator/graph";
import { describe, expect, it } from "vitest";

const createRootDir = async () =>
  mkdtemp(join(tmpdir(), "ao-workflow-audit-"));

describe("workflow audit events", () => {
  it("writes start and completion audit events for leader-worker workflow", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await runLeaderWorkerWorkflow({
      context,
      goal: "Review the repository for workflow regressions"
    });
    const events = await listAuditEvents(rootDir, 20);

    expect(
      events.some(
        (event) =>
          event.actor === "workflow" &&
          event.action === "start" &&
          event.workflow === "leader-worker-workflow"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.actor === "workflow" &&
          event.action === "complete" &&
          event.workflow === "leader-worker-workflow"
      )
    ).toBe(true);
  });
});
