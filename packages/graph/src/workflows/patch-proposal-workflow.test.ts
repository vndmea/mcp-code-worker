import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createExecutionContextFromEnv,
  type RepositoryContextPack,
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
      allowPatchGeneration: true,
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
  it("returns a structured proposal and inspects or safely degrades it", async () => {
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
    expect(result.proposal.unifiedDiff).toContain("diff --git");
    expect(result.inspection.files.length).toBeGreaterThan(0);
    if (result.proposal.title.includes("[PLACEHOLDER]")) {
      expect(result.inspection.ok).toBe(false);
      expect(result.warnings).toContain(
        "Structured patch output produced a corrupt unified diff."
      );
    } else {
      expect(result.inspection.ok).toBe(true);
      expect(result.proposal.unifiedDiff).not.toContain("manual review");
    }
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

  it("blocks structured proposals whose unified diff fails git apply --check", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    const invokeStructuredSpy = vi
      .spyOn(models, "invokeStructured")
      .mockResolvedValue({
        ok: true,
        data: {
          id: "patch-bad-diff",
          title: "Broken diff",
          summary: "Structured output returned a malformed diff.",
          rationale: ["Used to verify git apply validation during inspection."],
          unifiedDiff: [
            "diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts",
            "--- a/packages/core/src/index.ts",
            "+++ b/packages/core/src/index.ts",
            "@@ -1,1 +1,2 @@",
            "+// broken patch"
          ].join("\n"),
          files: [
            {
              path: "packages/core/src/index.ts",
              changeType: "modify",
              summary: "Broken test diff",
              riskLevel: "low"
            }
          ],
          risks: [],
          validationPlan: ["Run typecheck"],
          generatedAt: new Date().toISOString(),
          source: {
            workflow: "patch-generation-worker",
            workerId,
            scope: "packages/core"
          }
        },
        rawText: "",
        raw: undefined,
        attempts: 1,
        errors: []
      });

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      workerId
    });

    expect(result.inspection.ok).toBe(false);
    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.warnings).toContain(
      "Structured patch output produced a corrupt unified diff."
    );
    expect(result.inspection.blockedReasons.join("\n")).toContain(
      "Structured patch output produced a corrupt unified diff."
    );
    expect(result.inspection.blockedReasons.join("\n")).toContain(
      "Patch proposal is a fallback placeholder and must not be applied."
    );
    expect(result.inspection.blockedReasons.join("\n")).toContain(
      "corrupt patch"
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

  it("passes the full primary patch target content instead of a truncated repository context blob", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
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
      workerId
    });

    expect(capturedPrompt).toContain("Use only the provided repository context.");
    expect(capturedPrompt).toContain(
      "Treat the host-selected relevant files as the only allowed patch scope for this proposal."
    );
    expect(capturedPrompt).toContain("Allowed patch files:");
    expect(capturedPrompt).toContain(
      "If the real fix requires changes outside the allowed patch files, do not expand scope yourself."
    );
    expect(capturedPrompt).toContain(
      "return a non-actionable placeholder proposal whose title starts with '[PLACEHOLDER]'"
    );
    expect(capturedPrompt).toContain("Host relevance ranking:");
    expect(capturedPrompt).toContain("Primary patch target: packages/core/src/index.ts");
    expect(capturedPrompt).toContain("Primary patch target full content:");
    expect(capturedPrompt).toContain("Full-content patch context files");
    expect(capturedPrompt).toContain("<<<FILE:packages/core/src/index.ts>>>");
    expect(capturedPrompt).toContain("<<<FILE:packages/core/package.json>>>");
    expect(capturedPrompt).toContain("export const value = 1;");
    expect(capturedPrompt).not.toContain("\"selectedFiles\":");

    invokeStructuredSpy.mockRestore();
  });

  it("turns the minimal TS2322 success case into a ready-for-review patch that passes inspect and dry-run apply", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    await mkdir(join(rootDir, "tmp", "patch-success-case", "src"), {
      recursive: true
    });
    await writeFile(
      join(rootDir, "tmp", "patch-success-case", "src", "score.ts"),
      [
        "export const formatScore = (score: number): string => {",
        "  return score;",
        "};",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(rootDir, "tmp", "patch-success-case", "src", "score.test.ts"),
      [
        "import { describe, expect, it } from \"vitest\";",
        "",
        "import { formatScore } from \"./score\";",
        "",
        "describe(\"formatScore\", () => {",
        "  it(\"returns the numeric score as a string\", () => {",
        "    expect(formatScore(7)).toBe(\"7\");",
        "  });",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );
    const errorLog = [
      "tmp/patch-success-case/src/score.ts:2:3 - error TS2322: Type 'number' is not assignable to type 'string'.",
      "",
      "2   return score;",
      "    ~~~~~~"
    ].join("\n");
    let capturedPrompt = "";
    const invokeStructuredSpy = vi
      .spyOn(models, "invokeStructured")
      .mockImplementation((request) => {
        capturedPrompt = request.prompt;
        return Promise.resolve({
          ok: true,
          data: {
            id: "patch-score-ts2322-fix",
            title: "Fix TS2322 in score.ts by returning a string",
            summary: "Convert the numeric return value to a string so the implementation matches the declared return type.",
            rationale: [
              "The error log points directly to score.ts.",
              "The allowed patch scope already includes the implementation and paired test file."
            ],
            unifiedDiff: [
              "diff --git a/tmp/patch-success-case/src/score.ts b/tmp/patch-success-case/src/score.ts",
              "--- a/tmp/patch-success-case/src/score.ts",
              "+++ b/tmp/patch-success-case/src/score.ts",
              "@@ -1,3 +1,3 @@",
              " export const formatScore = (score: number): string => {",
              "-  return score;",
              "+  return score.toString();",
              " };"
            ].join("\n") + "\n",
            files: [
              {
                path: "tmp/patch-success-case/src/score.ts",
                changeType: "modify",
                summary: "Convert the returned number into a string.",
                riskLevel: "low"
              }
            ],
            risks: ["Low risk: preserves behavior while satisfying the declared return type."],
            validationPlan: [
              "Run the score test fixture.",
              "Run TypeScript typecheck for the affected file."
            ],
            generatedAt: new Date().toISOString(),
            source: {
              workflow: "patch-generation-worker",
              workerId,
              scope: "tmp/patch-success-case/src"
            }
          },
          rawText: "",
          raw: undefined,
          attempts: 1,
          errors: []
        });
      });

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the concrete TS2322 defect proven by the provided error log. Only update the directly related implementation or its paired test if needed.",
      scope: "tmp/patch-success-case/src",
      errorLog,
      workerId,
      requireProfile: true
    });

    expect(capturedPrompt).toContain("Allowed patch files:");
    expect(capturedPrompt).toContain("Primary patch target: tmp/patch-success-case/src/score.ts");
    expect(capturedPrompt).toContain("<<<FILE:tmp/patch-success-case/src/score.ts>>>");
    expect(capturedPrompt).toContain("<<<FILE:tmp/patch-success-case/src/score.test.ts>>>");
    expect(capturedPrompt).toContain("return score;");
    expect(capturedPrompt).toContain("TS2322");
    expect(result.proposal.title).toBe("Fix TS2322 in score.ts by returning a string");
    expect(result.proposal.unifiedDiff).toContain("return score.toString();");
    expect(result.proposal.unifiedDiff).not.toContain("[PLACEHOLDER]");
    expect(result.inspection.ok).toBe(true);
    expect(result.inspection.blockedReasons).toEqual([]);
    expect(result.inspection.files).toHaveLength(1);
    expect(result.inspection.files[0]?.path).toBe("tmp/patch-success-case/src/score.ts");

    const applyResult = await applyPatchProposal(createContext(rootDir), result.proposal, {
      dryRun: true
    });

    expect(applyResult.mode).toBe("dry-run");
    expect(applyResult.errors).toEqual([]);
    expect(applyResult.touchedFiles).toEqual(["tmp/patch-success-case/src/score.ts"]);

    invokeStructuredSpy.mockRestore();
  });

  it("prefers cross-language source files over config files when choosing the primary patch target", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
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
    const repositoryContext: RepositoryContextPack = {
      rootDir,
      scope: "services/api",
      files: [],
      selectedFiles: [
        {
          path: "services/api/package.json",
          content: "{\n  \"name\": \"api\"\n}\n",
          truncated: false,
          sizeBytes: 20
        },
        {
          path: "services/api/src/app.py",
          content: "def main():\n    return 'ok'\n",
          truncated: false,
          sizeBytes: 28
        },
        {
          path: "services/api/src/App.vue",
          content: "<script setup>\nconst answer = 42\n</script>\n",
          truncated: false,
          sizeBytes: 42
        }
      ],
      selectionReasons: [
        {
          path: "services/api/src/App.vue",
          reason: "Mentioned by the host as a likely UI integration point.",
          score: 9
        },
        {
          path: "services/api/src/app.py",
          reason: "Primary runtime entrypoint for the failing service.",
          score: 10
        },
        {
          path: "services/api/package.json",
          reason: "Config metadata only.",
          score: 2
        }
      ],
      requestedFiles: [],
      skippedFiles: [],
      coverageGapDetected: false,
      strictFiles: false,
      warnings: [],
      generatedAt: new Date().toISOString()
    };

    await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing app behavior",
      repositoryContext,
      scope: "services/api",
      workerId
    });

    expect(capturedPrompt).toContain("Primary patch target: services/api/src/app.py");
    expect(capturedPrompt).toContain("<<<FILE:services/api/src/app.py>>>");
    expect(capturedPrompt).toContain("Allowed patch files:");
    expect(capturedPrompt).toContain("Host relevance ranking:");
    expect(capturedPrompt).toContain("- services/api/package.json");
    expect(capturedPrompt).toContain("- services/api/src/app.py");
    expect(capturedPrompt).toContain("- services/api/src/App.vue");
    expect(capturedPrompt).toContain("Full-content patch context files (3):");
    expect(capturedPrompt).toContain("<<<FILE:services/api/package.json>>>");
    expect(capturedPrompt).toContain("<<<FILE:services/api/src/App.vue>>>");
    expect(capturedPrompt).not.toContain("Primary patch target: services/api/package.json");

    invokeStructuredSpy.mockRestore();
  });

  it("returns a blocked placeholder when the persisted worker profile never qualified for patch generation", async () => {
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
        supportedTaskTypes: createProfile().supportedTaskTypes.filter(
          (taskType) => taskType !== "patch-generation"
        ),
        routingPolicy: {
          ...createProfile().routingPolicy,
          allowPatchGeneration: false
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

    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.inspection.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("not qualified for patch-generation tasks");
    expect(result.inspection.blockedReasons).toContain(
      "Patch proposal is a fallback placeholder and must not be applied."
    );
  });

  it("blocks profiles that are missing the patch-generation support tag", async () => {
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

    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.inspection.ok).toBe(false);
    expect(result.warnings.join("\n")).toContain("inconsistent for patch-generation");
    expect(result.warnings.join("\n")).toContain("--update-profile-capabilities");
  });

  it("blocks patch generation when overall profile status is not-qualified even if patch flags are present", async () => {
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
        status: "not-qualified",
        warnings: ["review-grounding warning"],
        unsupportedTaskTypes: []
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

    expect(result.proposal.title).toContain("[PLACEHOLDER]");
    expect(result.warnings.join("\n")).toContain("not-qualified");
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

