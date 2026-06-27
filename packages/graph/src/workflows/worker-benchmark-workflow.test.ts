import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  listAuditEvents,
  WorkerCapabilityProfileSchema
} from "@agent-orchestrator/core";
import {
  applyBenchmarkCapabilityUpdate,
  runWorkerBenchmarkWorkflow,
  saveWorkerBenchmarkArtifact
} from "@agent-orchestrator/graph";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-worker-benchmark-"));

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: true,
    dryRun: false
  });

const createProfile = (overrides: Record<string, unknown> = {}) =>
  WorkerCapabilityProfileSchema.parse({
    workerId: "mock:gpt-5.4-mini",
    provider: "mock",
    model: "gpt-5.4-mini",
    status: "active",
    supportedTaskTypes: [
      "summarization",
      "log-analysis",
      "json-extraction",
      "review-lite",
      "codegen",
      "test-generation"
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
    suiteVersion: "2",
    ...overrides
  });

describe("worker benchmark workflow", () => {
  it("runs the coding-v1 suite and returns an evaluation summary", async () => {
    const rootDir = await createRootDir();
    const result = await runWorkerBenchmarkWorkflow({
      context: createContext(rootDir),
      suite: "coding-v1"
    });

    expect(result.suiteName).toBe("coding-v1");
    expect(result.fixtureResults).toHaveLength(4);
    expect(result.evaluationSummary.sampleCount).toBe(4);
    expect(result.evaluationSummary.failedCount).toBe(0);
  });

  it("persists benchmark artifacts and captures failure modes from bad fixture responses", async () => {
    const rootDir = await createRootDir();
    const context = createContext(rootDir);
    const result = await runWorkerBenchmarkWorkflow({
      context,
      suite: "coding-v1",
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
    const saved = JSON.parse(await readFile(persistence.path, "utf8")) as {
      evaluationSummary: { knownFailureModes: string[] };
    };

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
      suite: "coding-v1"
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
    expect(withUpdate.profile.supportedTaskTypes).toContain("patch-generation");
    expect(withUpdate.profile.routingPolicy.allowPatchGeneration).toBe(true);
  });

  it("does not grant patch-generation when required benchmark fixtures fail", async () => {
    const rootDir = await createRootDir();
    const result = await runWorkerBenchmarkWorkflow({
      context: createContext(rootDir),
      suite: "coding-v1",
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

