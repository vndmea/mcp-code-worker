import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createExecutionContextFromEnv,
  type ValidationReport,
  WorkerCapabilityProfileSchema
} from "@mcp-code-worker/core";
import {
  saveWorkerProfile,
  saveWorkerRegistration
} from "@mcp-code-worker/models";
import * as models from "@mcp-code-worker/models";
import {
  runFixErrorWorkflow,
  runPatchProposalWorkflow
} from "@mcp-code-worker/graph";
import { applyPatchProposal } from "@mcp-code-worker/tools";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-patch-proposal-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
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

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    dryRun: true,
    allowWrite: false
  });

const createWriteContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    dryRun: false,
    allowWrite: true
  });

const workerId = "mock:gpt-5.4-mini";

const registerWorker = async (rootDir: string): Promise<void> => {
  const context = createWriteContext(rootDir);

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
      "validation-fix",
      "doc-generation",
      "patch-generation"
    ],
    unsupportedTaskTypes: [],
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
    admission: {
      passed: true,
      blockingReasons: []
    },
    portrait: {
      scopeDiscipline: 0.83,
      repoGrounding: 0.81,
      answerDirectness: 0.8,
      codeUnderstanding: 0.79,
      fixPlanning: 0.8,
      implementationPlanning: 0.82,
      consistency: 0.86
    },
    taskScores: {
      summarization: 0.8,
      codeUnderstanding: 0.79,
      riskAnalysis: 0.8,
      reviewLite: 0.8,
      codegen: 0.82,
      patchGeneration: 0.81,
      testGeneration: 0.82,
      validationFix: 0.82,
      logAnalysis: 0.79,
      jsonExtraction: 0.78,
      docGeneration: 0.8
    },
    evidence: {
      failedCases: [],
      repoGroundedCases: ["structured-output", "scope-discipline", "summarization"],
      fallbackPatternCases: [],
      genericAnswerCases: []
    },
    ...overrides
  });

describe("patch proposal workflow", () => {
  it("returns a structured proposal with inspection", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      workerId
    });

    expect(result.proposal.id).toBeTruthy();
    expect(result.proposal.title).not.toContain("[PLACEHOLDER]");
    expect(result.proposal.unifiedDiff).toContain("diff --git");
    expect(result.proposal.unifiedDiff).not.toContain("manual review");
    expect(result.inspection.files.length).toBeGreaterThan(0);
  });

  it("marks fallback proposals as denied when model output is invalid", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const invokeStructuredSpy = vi
      .spyOn(models, "invokeStructured")
      .mockResolvedValue({
        ok: false,
        rawText: "",
        raw: undefined,
        attempts: 1,
        errors: ["schema validation failed"],
        failureKind: "schema-validation"
      });

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      workerId
    });

    expect(result.inspection.ok).toBe(false);
    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.proposal.summary).toContain("not an actionable fix");
    expect(result.warnings[0]).toContain("must not be applied");
    expect(result.inspection.blockedReasons).toContain(
      "Patch proposal is a fallback placeholder and must not be applied."
    );
    expect(result.inspection.blockedReasons).toContain("schema validation failed");

    const applyResult = await applyPatchProposal(createContext(rootDir), result.proposal, {
      dryRun: true
    });

    expect(applyResult.mode).toBe("denied");
    expect(applyResult.errors).toContain(
      "Patch proposal is a fallback placeholder and must not be applied."
    );

    invokeStructuredSpy.mockRestore();
  });

  it("passes validation reports through to structured patch generation", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const validationReport: ValidationReport = {
      ok: false,
      warnings: ["typecheck still failing"],
      checks: [
        {
          name: "typecheck",
          command: "pnpm typecheck",
          status: "failure",
          stderr: "TS2304: Cannot find name 'missingValue'."
        }
      ]
    };
    let capturedPrompt = "";
    const invokeStructuredSpy = vi
      .spyOn(models, "invokeStructured")
      .mockImplementation((request) => {
        capturedPrompt = request.prompt;
        return Promise.resolve({
          ok: true,
          data: request.mockResponse,
          rawText: JSON.stringify(request.mockResponse),
          raw: request.mockResponse,
          attempts: 1,
          errors: []
        });
      });

    await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      validationReport,
      workerId
    });

    expect(capturedPrompt).toContain("Validation report:");
    expect(capturedPrompt).toContain("pnpm typecheck");
    expect(capturedPrompt).toContain("missingValue");

    invokeStructuredSpy.mockRestore();
  });

  it("returns a blocked placeholder when the persisted worker profile is not qualified for patch generation", async () => {
    const rootDir = await createWorkspace();
    await saveWorkerRegistration(
      createWriteContext(rootDir),
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
    await saveWorkerProfile(createWriteContext(rootDir), createProfile(), true);

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      workerId,
      requireProfile: true
    });

    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.inspection.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("not allowed to generate patch proposals");
    expect(result.inspection.blockedReasons).toContain(
      "Patch proposal is a fallback placeholder and must not be applied."
    );
  });

  it("accepts legacy qualified profiles that allow patch generation even without the supported task tag", async () => {
    const rootDir = await createWorkspace();
    await saveWorkerRegistration(
      createWriteContext(rootDir),
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
      createWriteContext(rootDir),
      createProfile({
        supportedTaskTypes: [
          "summarization",
          "code-understanding",
          "log-analysis",
          "json-extraction",
          "review-lite",
          "risk-analysis",
          "codegen",
          "validation-fix",
          "doc-generation"
        ],
        unsupportedTaskTypes: [],
        routingPolicy: {
          ...createProfile().routingPolicy,
          allowPatchGeneration: true
        }
      }),
      true
    );

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      workerId,
      requireProfile: true
    });

    expect(result.proposal.title).not.toContain("[PLACEHOLDER]");
    expect(result.inspection.ok).toBe(true);
  });
});

describe("fix workflow patch integration", () => {
  it("does not generate patch proposals by default", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      scope: "packages/core",
      workerId
    });

    expect(result.patchProposal).toBeUndefined();
    expect(result.patchInspection).toBeUndefined();
  });

  it("includes patch proposal output when requested", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      scope: "packages/core",
      workerId,
      proposePatch: true
    });

    expect(result.patchProposal?.unifiedDiff).toContain("diff --git");
    expect(result.patchInspection).toBeDefined();
  });
});

