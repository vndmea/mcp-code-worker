import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  listAuditEvents,
  openSqliteWorkspaceStore,
  WorkerCapabilityProfileSchema
} from "@mcp-code-worker/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "@mcp-code-worker/graph";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-benchmark-"));

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: true,
    dryRun: false
  });

const workerId = "mock:gpt-5.4-mini";

const createProfile = (overrides: Record<string, unknown> = {}) =>
  WorkerCapabilityProfileSchema.parse({
    workerId: "mock:gpt-5.4-mini",
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
    unsupportedTaskTypes: ["patch-generation"],
    score: {
      instructionFollowing: 0.9,
      structuredOutput: 0.9,
      reasoning: 0.9,
      codeQuality: 0.9,
      domainKnowledge: 0.8,
      reliability: 0.9
    },
    risks: [],
    warnings: [],
    routingPolicy: {
      maxTaskComplexity: "medium",
      requiresHostReview: false,
      allowCodegen: true,
      allowPatchGeneration: false,
      allowDomainTasks: true
    },
    evaluatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    suiteName: "default-worker-onboarding-suite",
    suiteVersion: "6",
    ...overrides
  });

describe("worker benchmark workflow", () => {
  it("runs the coding-v1 suite and returns an evaluation summary", async () => {
    const rootDir = await createRootDir();
    const result = await runWorkerBenchmarkWorkflow({
      context: createContext(rootDir),
      suite: "coding-v1",
      workerId
    });

    expect(result.suiteName).toBe("coding-v1");
    expect(result.fixtureResults).toHaveLength(4);
    expect(result.evaluationSummary.sampleCount).toBe(4);
    expect(result.evaluationSummary.failedCount).toBe(0);
  });

  it.skip("persists benchmark artifacts and captures failure modes from bad fixture responses", async () => {
    const rootDir = await createRootDir();
    const context = createContext(rootDir);
    const result = await runWorkerBenchmarkWorkflow({
      context,
      suite: "coding-v1",
      workerId,
      simulatedResponses: {
        "validation-honesty": {
          summary: "Apply immediately.",
          shouldApply: true,
          requiredChecks: ["typecheck"],
          confidence: 0.95
        }
      }
    });
    const persistence = await saveWorkerBenchmarkArtifact(context, result, true);
    const db = await openSqliteWorkspaceStore(context.cwStorageDir);
    let saved: { evaluationSummary: { knownFailureModes: string[] } };
    try {
      const row = db.prepare(
        `SELECT benchmark_json
         FROM worker_benchmarks
         WHERE worker_id = ? AND suite_name = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`
      ).get(workerId, "coding-v1") as { benchmark_json: string };
      saved = JSON.parse(row.benchmark_json) as {
        evaluationSummary: { knownFailureModes: string[] };
      };
    } finally {
      db.close();
    }

    expect(persistence.mode).toBe("execute");
    expect(result.evaluationSummary.failedCount).toBe(1);
    expect(saved.evaluationSummary.knownFailureModes.join("\n")).toContain(
      "willing to apply"
    );

    const auditEvents = await listAuditEvents(rootDir, 10);
    expect(auditEvents.some((event) =>
      event.action === "worker-benchmark" &&
      event.workflow === "worker-benchmark-workflow" &&
      event.metadata?.workerId === result.workerId
    )).toBe(true);
  });

  it("grants patch-generation only when capability updates are explicitly requested", async () => {
    const rootDir = await createRootDir();
    const result = await runWorkerBenchmarkWorkflow({
      context: createContext(rootDir),
      suite: "coding-v1",
      workerId
    });
    const baseline = createProfile();

    const withoutUpdate = applyBenchmarkCapabilityUpdate(baseline, result, {
      updateProfileCapabilities: false
    });
    const withUpdate = applyBenchmarkCapabilityUpdate(baseline, result, {
      updateProfileCapabilities: true
    });

    expect(withoutUpdate.patchGenerationQualified).toBe(true);
    expect(withoutUpdate.profile.supportedTaskTypes).not.toContain("patch-generation");
    expect(withUpdate.capabilityUpdateApplied).toBe(true);
    expect(withUpdate.patchGenerationQualified).toBe(true);
    expect(withUpdate.profile.supportedTaskTypes).toContain("patch-generation");
    expect(withUpdate.profile.routingPolicy.allowPatchGeneration).toBe(true);
  });

  it("does not grant patch-generation when required benchmark fixtures fail", async () => {
    const rootDir = await createRootDir();
    const result = await runWorkerBenchmarkWorkflow({
      context: createContext(rootDir),
      suite: "coding-v1",
      workerId,
      simulatedResponses: {
        "scope-control": {
          allowedFiles: ["packages/core/src/index.ts"],
          blockedFiles: [],
          confidence: 0.95
        }
      }
    });
    const updated = applyBenchmarkCapabilityUpdate(createProfile(), result, {
      updateProfileCapabilities: true
    });

    expect(updated.patchGenerationQualified).toBe(false);
    expect(updated.profile.supportedTaskTypes).not.toContain("patch-generation");
    expect(updated.profile.routingPolicy.allowPatchGeneration).toBe(false);
  });
});

