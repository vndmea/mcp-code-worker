import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  readTaskArtifact,
  readTaskSession,
  WorkerCapabilityProfileSchema
} from "@mcp-code-worker/core";
import {
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";
import {
  getTaskSessionReport,
  resumeTaskSessionWorkflow,
  runTaskSessionWorkflow
} from "@mcp-code-worker/graph";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-task-workflow-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "package.json"),
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
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 1;\n",
    "utf8"
  );
  await mkdir(join(rootDir, "tmp"), { recursive: true });
  await writeFile(
    join(rootDir, "tmp", "error.log"),
    "TS2304: Cannot find name 'missingValue'.\n",
    "utf8"
  );
  return rootDir;
};

const createContext = (
  rootDir: string,
  options: { allowWrite?: boolean; dryRun?: boolean } = {}
) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: options.allowWrite ?? false,
    dryRun: options.dryRun ?? true
  });

const workerId = "mock:task-worker";

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
      "patch-generation",
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

describe("task session workflow", () => {
  it("runs a dry-run task session with review and validation", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const result = await runTaskSessionWorkflow({
      context: createContext(rootDir),
      goal: "Review packages/core",
      scope: "packages/core",
      workerId,
      validate: {
        typecheck: true
      }
    });

    expect(result.mode).toBe("dry-run");
    expect(result.session.status).toBe("completed");
    expect(result.repositoryContext?.scope).toBe("packages/core");
    expect(result.validationReport?.checks[0]?.status).toBe("dry-run");
    expect(result.nextRecommendedActions[0]?.action).toBe("view_report");
    expect(result.persistence.sessionPersisted).toBe(false);
    expect(result.persistence.resumable).toBe(false);
  });

  it("persists separate artifacts and report when session writes are allowed", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const result = await runTaskSessionWorkflow({
      context: createContext(rootDir, {
        allowWrite: true,
        dryRun: false
      }),
      goal: "Review and propose patch",
      scope: "packages/core",
      workerId,
      errorLogFile: "tmp/error.log",
      runFix: true,
      validate: {
        typecheck: true
      },
      proposePatch: true,
      inspectPatch: true,
      allowWriteSession: true
    });

    const persisted = await readTaskSession(rootDir, result.session.taskId);
    const repositoryContextArtifact = await readTaskArtifact(
      rootDir,
      result.session.taskId,
      "repository-context.json"
    );
    const validationArtifact = await readTaskArtifact(
      rootDir,
      result.session.taskId,
      "validation-report.json"
    );
    const fixArtifact = await readTaskArtifact(
      rootDir,
      result.session.taskId,
      "fix-result.json"
    );
    const report = await getTaskSessionReport(rootDir, result.session.taskId);

    expect(result.patchProposal?.id).toBeTruthy();
    expect(result.patchInspection).toBeDefined();
    expect(result.fixResult?.rootCauseAnalysis).toContain("error log");
    expect(result.nextRecommendedActions[0]?.action).toBe("view_report");
    expect(persisted?.artifacts["report.md"]).toContain("data.db#task_sessions");
    expect(result.persistence.sessionPersisted).toBe(true);
    expect(result.persistence.artifactRegistryComplete).toBe(true);
    expect(persisted?.artifacts["repository-context.json"]).toContain("data.db#task_sessions");
    expect(persisted?.artifacts["review-result.json"]).toContain("data.db#task_sessions");
    expect(persisted?.artifacts["validation-report.json"]).toContain("data.db#task_sessions");
    expect(persisted?.artifacts["fix-result.json"]).toContain("data.db#task_sessions");
    expect(repositoryContextArtifact.exists).toBe(true);
    expect(validationArtifact.exists).toBe(true);
    expect(fixArtifact.exists).toBe(true);
    expect(persisted?.steps.some((step) => step.id === "fix-planned" && step.status === "success")).toBe(true);
    expect(report.report).toContain("Task Session Report");
  }, 15_000);

  it("blocks patch apply without explicit confirmation gates", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const result = await runTaskSessionWorkflow({
      context: createContext(rootDir, {
        allowWrite: true,
        dryRun: false
      }),
      goal: "Review and apply patch",
      scope: "packages/core",
      workerId,
      proposePatch: true,
      inspectPatch: true,
      applyPatch: true,
      allowWrite: true
    });

    expect(result.patchApplyResult?.mode).toBe("denied");
    expect(result.session.status).toBe("needs-review");
    expect(result.nextRecommendedActions[0]?.action).toBe("view_report");
  });

  it("resumes from patch application steps without rerunning successful review", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const initial = await runTaskSessionWorkflow({
      context: createContext(rootDir, {
        allowWrite: true,
        dryRun: false
      }),
      goal: "Review and prepare patch",
      scope: "packages/core",
      workerId,
      proposePatch: true,
      inspectPatch: true,
      allowWriteSession: true
    });
    const resumed = await resumeTaskSessionWorkflow({
      context: createContext(rootDir, {
        allowWrite: true,
        dryRun: false
      }),
      taskId: initial.session.taskId,
      fromStep: "patch-applied",
      applyPatch: true,
      allowWrite: true,
      confirmApply: true,
      allowWriteSession: true
    });

    expect(resumed.patchApplyResult?.mode).toBe("denied");
    expect(resumed.session.steps.find((step) => step.id === "patch-applied")?.status).toBe("denied");
    expect(resumed.session.steps.find((step) => step.id === "reviewed")?.status).toBe("success");
  });

  it("supports inline error logs for fix planning", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const result = await runTaskSessionWorkflow({
      context: createContext(rootDir),
      goal: "Fix inline error",
      scope: "packages/core",
      workerId,
      errorLog: "TS1005: ';' expected",
      runFix: true
    });

    expect(result.fixResult?.rootCauseAnalysis).toContain("error log");
    expect(result.session.steps.find((step) => step.id === "fix-planned")?.status).toBe("success");
  });

  it("marks placeholder patch proposals as denied at the proposal step", async () => {
    const rootDir = await createWorkspace();
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
    await saveWorkerProfile(
      context,
      {
        ...createProfile(),
        status: "not-qualified",
        supportedTaskTypes: createProfile().supportedTaskTypes.filter(
          (taskType) => taskType !== "patch-generation"
        ),
        routingPolicy: {
          ...createProfile().routingPolicy,
          allowPatchGeneration: false
        }
      },
      true
    );

    const result = await runTaskSessionWorkflow({
      context: createContext(rootDir, {
        allowWrite: true,
        dryRun: false
      }),
      goal: "Review and propose patch",
      scope: "packages/core",
      workerId,
      proposePatch: true,
      inspectPatch: true
    });

    expect(result.session.steps.find((step) => step.id === "patch-proposed")?.status).toBe("denied");
    expect(result.session.steps.find((step) => step.id === "patch-inspected")?.status).toBe("denied");
    expect(result.patchProposal?.title).toContain("[PLACEHOLDER]");
  });
});
