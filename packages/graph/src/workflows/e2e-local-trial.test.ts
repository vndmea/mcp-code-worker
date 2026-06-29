import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  listAuditEvents
} from "@mcp-code-worker/core";
import {
  getTaskSessionReport,
  runPatchProposalWorkflow,
  runTaskSessionWorkflow,
  runWorkerInterviewWorkflow
} from "@mcp-code-worker/graph";
import {
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-e2e-trial-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "node -e \"process.exit(0)\"",
          lint: "node -e \"process.exit(0)\"",
          test: "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 1;\n",
    "utf8"
  );
  return rootDir;
};

describe("local trial e2e", () => {
  it("covers the happy path without network calls or patch apply", async () => {
    const rootDir = await createWorkspace();
    const executeContext = createExecutionContextFromEnv(undefined, {
      rootDir,
      allowWrite: true,
      dryRun: false
    });
    const workerId = "mock:trial-worker";

    await saveWorkerRegistration(
      executeContext,
      {
        workerId,
        provider: "mock",
        model: "trial-worker",
        enabled: true,
        tags: ["trial"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      true
    );
    const interview = await runWorkerInterviewWorkflow({
      context: executeContext,
      workerId,
      modelConfig: {
        provider: "mock",
        model: "trial-worker"
      }
    });
    await saveWorkerProfile(executeContext, interview.profile, true);

    const task = await runTaskSessionWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        rootDir,
        allowWrite: false,
        dryRun: true,
        workerModel: {
          provider: "mock",
          model: "trial-worker"
        }
      }),
      goal: "Review packages/core",
      scope: "packages/core",
      workerId,
      requireProfile: true,
      validate: {
        typecheck: true
      },
      allowWriteSession: true
    });
    const patch = await runPatchProposalWorkflow({
      context: createExecutionContextFromEnv(undefined, {
        rootDir,
        allowWrite: false,
        dryRun: true,
        workerModel: {
          provider: "mock",
          model: "trial-worker"
        }
      }),
      goal: "Generate a candidate patch",
      scope: "packages/core",
      workerId,
      requireProfile: true,
      repositoryContext: task.repositoryContext
    });
    const auditEvents = await listAuditEvents(rootDir, 20);
    const report = await getTaskSessionReport(rootDir, task.session.taskId);

    expect(interview.profile.workerId).toBe(workerId);
    expect(task.session.taskId).toBeTruthy();
    expect(task.validationReport?.checks[0]?.status).toBe("dry-run");
    expect(patch.proposal.id).toBeTruthy();
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(report.report).toContain("Task Session Report");
  });
});
