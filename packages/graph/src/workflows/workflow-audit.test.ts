import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createExecutionContextFromEnv, listAuditEvents } from "@mcp-code-worker/core";
import { runHostWorkerWorkflow } from "./host-worker-workflow.js";
import { describe, expect, it } from "vitest";

const createRootDir = async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-workflow-audit-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "src", "generateId.ts"),
    "export const generateId = () => 'id';\n",
    "utf8"
  );
  return rootDir;
};

describe("workflow audit events", () => {
  it("writes start and completion audit events for host-worker workflow", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await runHostWorkerWorkflow({
      context,
      goal: "Review the repository for workflow regressions",
      taskType: "review-lite",
      files: ["packages/core/src/generateId.ts"]
    });
    const events = await listAuditEvents(rootDir, 20);

    expect(
      events.some(
        (event) =>
          event.actor === "workflow" &&
          event.action === "start" &&
          event.workflow === "host-worker-workflow"
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.actor === "workflow" &&
          event.action === "complete" &&
          event.workflow === "host-worker-workflow"
      )
    ).toBe(true);
  });
});
