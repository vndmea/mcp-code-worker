import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createExecutionContextFromEnv,
  listAuditEvents,
  WorkerCapabilityProfileSchema
} from "@mcp-code-worker/core";
import {
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";
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

const workerId = "mock:audit-worker";

const createProfile = () =>
  WorkerCapabilityProfileSchema.parse({
    workerId,
    provider: "mock",
    model: "gpt-5.4-mini",
    status: "qualified",
    supportedTaskTypes: [
      "summarization",
      "code-understanding",
      "log-analysis",
      "json-extraction",
      "review-lite",
      "risk-analysis",
      "codegen",
      "test-generation",
      "validation-fix",
      "doc-generation"
    ],
    unsupportedTaskTypes: [],
    score: {
      instructionFollowing: 0.9,
      structuredOutput: 0.9,
      reasoning: 0.85,
      codeQuality: 0.82,
      domainKnowledge: 0.78,
      reliability: 0.88
    },
    risks: [],
    warnings: [],
    routingPolicy: {
      maxTaskComplexity: "medium",
      requiresHostReview: false,
      allowCodegen: true,
      allowPatchGeneration: true,
      allowDomainTasks: true
    },
    evaluatedAt: new Date().toISOString()
  });

const registerWorker = async (rootDir: string): Promise<void> => {
  const context = createExecutionContextFromEnv(undefined, {
    allowWrite: true,
    dryRun: false,
    rootDir
  });

  await saveWorkerRegistration(
    context,
    {
      workerId,
      provider: "mock",
      model: "gpt-5.4-mini",
      enabled: true,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    true
  );
  await saveWorkerProfile(context, createProfile(), true);
};

describe("workflow audit events", () => {
  it("writes start and completion audit events for host-worker workflow", async () => {
    const rootDir = await createRootDir();
    await registerWorker(rootDir);
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await runHostWorkerWorkflow({
      context,
      goal: "Review the repository for workflow regressions",
      taskType: "review-lite",
      files: ["packages/core/src/generateId.ts"],
      workerId
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
