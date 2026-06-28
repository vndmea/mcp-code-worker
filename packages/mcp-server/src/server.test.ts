import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AgentError,
  getCwConfigPath,
  getCwWorkspaceFilePath,
  PatchProposalSchema,
  type TaskSession
} from "@mcp-code-worker/core";
import type {
  FixErrorWorkflowOutput,
  ReviewWorkflowOutput,
  TaskSessionWorkflowOutput
} from "@mcp-code-worker/graph";
import {
  cwBenchmarkWorkerTool,
  cwApplyPatchTool,
  cwDoctorTool,
  cwFixErrorTool,
  cwGetTaskReportTool,
  cwGetTaskStatusTool,
  cwReadTaskArtifactTool,
  cwGetWorkerRegistrationTool,
  cwInspectPatchTool,
  cwListTasksTool,
  cwListModelsTool,
  cwListToolsTool,
  cwReviewDiffTool,
  cwReviewFilesTool,
  cwReviewRepositoryTool,
  cwResumeTaskTool,
  cwListWorkerRegistryTool,
  cwProposePatchTool,
  cwRegisterWorkerTool,
  cwRunWorkerInterviewTool,
  cwRunHostWorkerTool,
  cwStartTaskTool,
  cwToolDefinitions,
  formatUserFacingToolErrorMessage,
  toStructuredContent,
  cwUnregisterWorkerTool,
  cwValidateRepositoryTool,
  mcpToolCatalog
} from "@mcp-code-worker/mcp-server";

const execFile = promisify(execFileCallback);

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "cw-mcp-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

const writeProfiles = async (rootDir: string, profiles: unknown[]): Promise<void> => {
  const profilePath = getCwWorkspaceFilePath(rootDir, "worker-profiles.json");
  await mkdir(dirname(profilePath), { recursive: true });
  await writeFile(
    profilePath,
    JSON.stringify(profiles, null, 2),
    "utf8"
  );
};

const createPatchProposal = async (rootDir: string) => {
  const targetPath = join(rootDir, "packages", "core", "src", "index.ts");
  const originalContents = "export const value = 2;\n";
  await writeFile(targetPath, `// comment\n${originalContents}`, "utf8");
  const diff = await execFile("git", ["diff", "--", "packages/core/src/index.ts"], {
    cwd: rootDir
  });
  await writeFile(targetPath, originalContents, "utf8");

  return PatchProposalSchema.parse({
    id: "patch-1",
    title: "Add a candidate comment",
    summary: "Insert a comment above the export.",
    rationale: ["Used by MCP patch tests."],
    unifiedDiff: diff.stdout,
    files: [
      {
        path: "packages/core/src/index.ts",
        changeType: "modify",
        summary: "Insert a candidate comment.",
        riskLevel: "low"
      }
    ],
    risks: [],
    validationPlan: ["pnpm typecheck"],
    generatedAt: new Date().toISOString(),
    source: {
      workflow: "patch-proposal-workflow"
    }
  });
};

const writeWorkspaceFixture = async (rootDir: string): Promise<void> => {
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await mkdir(join(rootDir, "tmp"), { recursive: true });
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
  await writeFile(
    join(rootDir, "tmp", "error.log"),
    "TS2304: Cannot find name 'missingValue'.\n",
    "utf8"
  );
};

const writeCwConfig = async (rootDir: string, config: Record<string, unknown>): Promise<void> => {
  const configPath = getCwConfigPath(rootDir);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        ...config
      },
      null,
      2
    ),
    "utf8"
  );
};

const initGitRepo = async (rootDir: string): Promise<void> => {
  await execFile("git", ["init"], { cwd: rootDir });
  await execFile("git", ["config", "user.email", "cw@example.com"], { cwd: rootDir });
  await execFile("git", ["config", "user.name", "MCP Code Worker"], { cwd: rootDir });
  await execFile("git", ["add", "."], { cwd: rootDir });
  await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });
  await writeFile(
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 2;\n",
    "utf8"
  );
  await execFile("git", ["add", "packages/core/src/index.ts"], { cwd: rootDir });
  await execFile("git", ["commit", "-m", "update"], { cwd: rootDir });
};

const createProfile = () => ({
  workerId: "default-worker",
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
  }
});

const createLimitedProfile = () => ({
  ...createProfile(),
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
  routingPolicy: {
    maxTaskComplexity: "medium",
    requiresHostReview: false,
    allowCodegen: true,
    allowPatchGeneration: false,
    allowDomainTasks: true
  }
});

const extractCodeBulletList = (markdown: string, heading: string): string[] => {
  const headingPattern = new RegExp(`^## ${heading}\\r?\\n([\\s\\S]*?)(?=^## |\\Z)`, "m");
  const sectionMatch = markdown.match(headingPattern);

  if (!sectionMatch) {
    throw new Error(`Heading not found: ${heading}`);
  }

  const sectionBody = sectionMatch[1] ?? "";

  return sectionBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- `") && line.endsWith("`"))
    .map((line) => line.slice(3, -1));
};

describe("mcp tool registration", () => {
  it("registers the expected MCP tool names", () => {
    expect(cwToolDefinitions.map((tool) => tool.name)).toEqual(
      mcpToolCatalog.map((tool) => tool.name)
    );
  });

  it("keeps docs/mcp-server.md exposed tools in sync with the catalog", async () => {
    const markdown = await readFile(new URL("../../../docs/mcp-server.md", import.meta.url), "utf8");

    expect(extractCodeBulletList(markdown, "Exposed Tools")).toEqual(
      mcpToolCatalog.map((tool) => tool.name)
    );
  });

  it("lists configured models", async () => {
    const models = await cwListModelsTool.execute({});
    expect(models).toEqual([
      expect.objectContaining({
        role: "worker"
      })
    ]);
  });

  it("lists MCP tool definitions including dedicated workflow tools", async () => {
    const tools = await cwListToolsTool.execute({});
    const names = tools.groups.flatMap((group) => group.tools.map((tool) => tool.name));

    expect(names).toContain("cw_list_audit_events");
    expect(names).toContain("cw_register_worker");
    expect(names).toContain("cw_run_worker_interview");
    expect(names).toContain("cw_benchmark_worker");
    expect(names).toContain("cw_run_host_worker");
    expect(names).toContain("cw_propose_patch");
    expect(names).toContain("cw_review_repository");
    expect(names).toContain("cw_validate_repository");
    expect(names).toContain("cw_start_task");
    expect(names).toContain("cw_doctor");
    expect(tools.recommendedEntrypoints.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["cw_start_task", "cw_resume_task", "cw_get_task_report"])
    );
  });

  it("wraps array results into record-shaped structured content", () => {
    expect(toStructuredContent([{ name: "cw_list_tools" }])).toEqual({
      result: [{ name: "cw_list_tools" }]
    });
  });

  it("preserves plain object results as structured content", () => {
    expect(toStructuredContent({ ok: true, tool: "cw_doctor" })).toEqual({
      ok: true,
      tool: "cw_doctor"
    });
  });

  it("formats known agent errors into user-facing MCP messages", () => {
    expect(
      formatUserFacingToolErrorMessage(
        new AgentError("TASK_ARTIFACT_NOT_FOUND", "artifact report.md is missing")
      )
    ).toContain("artifact is not registered");
  });

  it("explains schema mismatches in user language", () => {
    const schemaResult = z
      .object({
        structuredContent: z.record(z.string(), z.unknown())
      })
      .safeParse({
        structuredContent: []
      });

    expect(schemaResult.success).toBe(false);

    if (schemaResult.success) {
      throw new Error("Expected schema mismatch.");
    }

    expect(formatUserFacingToolErrorMessage(schemaResult.error)).toContain(
      "request or response shape does not match the expected schema"
    );
  });

  it("explains record-versus-array compatibility failures in user language", () => {
    expect(
      formatUserFacingToolErrorMessage(
        new Error("structuredContent expected record, received array")
      )
    ).toContain("response format is incompatible");
  });

  it("manages worker registry through MCP tools", async () => {
    await withTempCwd(async () => {
      const dryRun = await cwRegisterWorkerTool.execute({
        workerId: "primary-worker",
        provider: "mock",
        model: "registered-worker"
      });

      expect(dryRun.mode).toBe("dry-run");

      const registered = await cwRegisterWorkerTool.execute({
        workerId: "primary-worker",
        provider: "mock",
        model: "registered-worker",
        tags: ["coding"],
        allowWrite: true
      });
      const registrations = await cwListWorkerRegistryTool.execute({});
      const registration = await cwGetWorkerRegistrationTool.execute({
        workerId: "primary-worker"
      });

      expect(registered.mode).toBe("execute");
      expect(registrations).toHaveLength(1);
      expect(JSON.stringify(registration)).not.toContain("secret");

      const removed = await cwUnregisterWorkerTool.execute({
        workerId: "primary-worker",
        allowWrite: true
      });

      expect(removed.removed).toBe(true);
    });
  });

  it("benchmarks a worker and can persist capability updates through MCP", async () => {
    await withTempCwd(async (rootDir) => {
      await writeCwConfig(rootDir, {
        defaultWorkerId: "default-worker",
        workerModel: {
          provider: "mock",
          model: "gpt-5.4-mini"
        }
      });
      await writeProfiles(rootDir, [createLimitedProfile()]);

      const result = await cwBenchmarkWorkerTool.execute({
        persistArtifact: true,
        updateProfileCapabilities: true
      });

      expect(result.persistence?.mode).toBe("execute");
      expect(result.persistence?.path).toContain("workspaces");
      expect(result.patchGenerationQualified).toBe(true);
      expect(result.capabilityUpdateApplied).toBe(true);
      expect(result.profilePersistence?.mode).toBe("execute");
    });
  });

  it("runs a fresh worker interview and can persist the generated profile through MCP", async () => {
    await withTempCwd(async () => {
      const result = await cwRunWorkerInterviewTool.execute({
        workerId: "interview-worker",
        provider: "mock",
        model: "interview-worker",
        persistProfile: true
      });

      expect(result.profile.workerId).toBe("interview-worker");
      expect(result.status).toBe("qualified");
      expect(result.persistence?.mode).toBe("execute");
      if (result.persistence?.mode !== "execute") {
        throw new Error("Expected persisted worker interview profile.");
      }
      expect(result.persistence.path).toContain("worker-profiles.json");
    });
  });

  it("executes the dedicated host-worker MCP tool", async () => {
    const result = await cwRunHostWorkerTool.execute({
      goal: "Review the selected repository files for direct implementation risks",
      taskType: "review-lite",
      files: ["packages/core/src/index.ts"],
      strictFiles: true
    });

    expect(result.workerResult).not.toBeNull();
    expect(result.qualityGate.answered).toBe(true);
    expect(result.qualityGate.workflowStatus).toBe("completed");
    expect(result.qualityGate.answerStatus).toBe("complete");
    expect(result.finalResult.status).toBe("success");
  });

  it("executes doctor and returns a structured report", async () => {
    await withTempCwd(async (rootDir) => {
      await writeProfiles(rootDir, [createProfile()]);

      const result = await cwDoctorTool.execute({});

      expect(result.checks.some((check) => check.name === "worker-profile-store")).toBe(true);
      expect(result.checks.some((check) => check.name === "default-worker-profile")).toBe(true);
    });
  });

  it("executes repository review, validation, and fix tools", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);

      const repoReview = await cwReviewRepositoryTool.execute({
        scope: "packages/core",
        typecheck: true,
        detailLevel: "full"
      }) as ReviewWorkflowOutput;
      const diffReview = await cwReviewDiffTool.execute({
        base: "HEAD",
        head: "HEAD",
        scope: "packages/core",
        detailLevel: "full"
      }) as ReviewWorkflowOutput;
      const fileReview = await cwReviewFilesTool.execute({
        files: ["packages/core/src/index.ts"],
        detailLevel: "full"
      }) as ReviewWorkflowOutput;
      const validation = await cwValidateRepositoryTool.execute({
        typecheck: true,
        detailLevel: "full"
      });
      const fix = await cwFixErrorTool.execute({
        errorLogFile: "tmp/error.log",
        scope: "packages/core",
        detailLevel: "full"
      }) as FixErrorWorkflowOutput;

      expect(repoReview.repositoryContext.scope).toBe("packages/core");
      expect(diffReview.repositoryContext.gitDiff).toBeDefined();
      expect(fileReview.repositoryContext.selectedFiles[0]?.path).toBe("packages/core/src/index.ts");
      expect(fileReview.qualityGate.workflowStatus).toBe("completed");
      expect(fileReview.qualityGate.answerStatus).toBe("complete");
      expect(validation.checks[0]?.status).toBe("dry-run");
      expect(fix.repositoryContext.scope).toBe("packages/core");
    });
  }, 15_000);

  it("uses cw config for repository review entrypoints", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);
      await writeCwConfig(rootDir, {
        context: {
          ignoredPaths: ["tmp"]
        }
      });

      const repoReview = await cwReviewRepositoryTool.execute({
        scope: "packages/core",
        detailLevel: "full"
      }) as ReviewWorkflowOutput;

      expect(repoReview.repositoryContext.selectedFiles.every((file) => file.truncated === false)).toBe(
        true
      );
    });
  }, 15_000);

  it("keeps MCP strict file review scoped to explicit files", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await writeFile(
        join(rootDir, "packages", "core", "src", "extra.ts"),
        "export const extra = true;\n",
        "utf8"
      );
      await writeFile(
        join(rootDir, "packages", "core", "src", "wide.ts"),
        "export const wide = '".concat("x".repeat(200), "';\n"),
        "utf8"
      );

      const result = await cwReviewFilesTool.execute({
        files: [
          "packages/core/src/index.ts",
          "packages/core/src/wide.ts"
        ],
        strictFiles: true,
        detailLevel: "full"
      }) as ReviewWorkflowOutput;

      expect(result.repositoryContext.selectedFiles.map((file) => file.path)).toEqual([
        "packages/core/src/index.ts",
        "packages/core/src/wide.ts"
      ]);
      expect(result.repositoryContext.selectedFiles.some((file) => file.path.endsWith("extra.ts"))).toBe(false);
    });
  });

  it("executes patch proposal, inspection, and apply tools", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      await initGitRepo(rootDir);
      const proposal = await createPatchProposal(rootDir);

      const proposed = await cwProposePatchTool.execute({
        goal: "Fix typecheck",
        scope: "packages/core"
      }) as Record<string, unknown>;
      const proposedFull = await cwProposePatchTool.execute({
        goal: "Fix typecheck",
        scope: "packages/core",
        detailLevel: "full"
      }) as {
        proposal: {
          unifiedDiff: string;
        };
      };
      const inspected = await cwInspectPatchTool.execute({
        patchProposal: proposal
      });
      const dryRunApply = await cwApplyPatchTool.execute({
        patchProposal: proposal
      });
      const blockedApply = await cwApplyPatchTool.execute({
        patchProposal: proposal,
        allowWrite: true
      });

      expect(proposed.proposalId).toBeTypeOf("string");
      expect(proposed).not.toHaveProperty("proposal");
      expect(proposedFull.proposal.unifiedDiff).toContain("diff --git");
      expect(inspected.files[0]?.path).toBe("packages/core/src/index.ts");
      expect(dryRunApply.mode).toBe("dry-run");
      expect(blockedApply.mode).toBe("blocked");
    });
  });

  it("executes task session tools", async () => {
    await withTempCwd(async (rootDir) => {
      await writeWorkspaceFixture(rootDir);
      const started = await cwStartTaskTool.execute({
        goal: "Review packages/core",
        scope: "packages/core",
        typecheck: true,
        allowWriteSession: true,
        detailLevel: "full"
      }) as TaskSessionWorkflowOutput;
      const listed = await cwListTasksTool.execute({
        detailLevel: "full"
      }) as TaskSession[];
      const status = await cwGetTaskStatusTool.execute({
        taskId: started.session.taskId,
        detailLevel: "full"
      }) as TaskSession;
      const report = await cwGetTaskReportTool.execute({
        taskId: started.session.taskId,
        detailLevel: "full"
      }) as { report: string; session: TaskSession };
      const artifactName = Object.keys(started.session.artifacts)[0] ?? "report.md";
      const artifact = await cwReadTaskArtifactTool.execute({
        taskId: started.session.taskId,
        artifactName,
        maxBytes: 256
      });
      const resumed = await cwResumeTaskTool.execute({
        taskId: started.session.taskId,
        proposePatch: true,
        inspectPatch: true,
        allowWriteSession: true,
        detailLevel: "full"
      }) as TaskSessionWorkflowOutput;

      expect(started.session.taskId).toBeTruthy();
      expect(listed[0]?.taskId).toBe(started.session.taskId);
      expect(status.taskId).toBe(started.session.taskId);
      expect(report.report).toContain("Task Session Report");
      expect(artifact.path).toContain(artifactName);
      expect(resumed.patchProposal?.id).toBeTruthy();
    });
  });
});

