import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  getCwWorkspaceFilePath
} from "@mcp-code-worker/core";
import {
  formatReviewWorkflowOutput,
  runFixErrorWorkflow,
  runReviewWorkflow
} from "@mcp-code-worker/graph";

const execFile = promisify(execFileCallback);
const workerId = "mock:registered-worker";

const createWorkspace = async (withGit = false): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-review-fix-"));
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
  if (withGit) {
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
  }

  return rootDir;
};

const registerWorker = async (rootDir: string): Promise<void> => {
  const registryPath = getCwWorkspaceFilePath(rootDir, "workers.json");
  await mkdir(dirname(registryPath), { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        version: 1,
        workers: [
          {
            workerId,
            provider: "mock",
            model: "gpt-5.4-mini",
            enabled: true,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
};

const createContext = (rootDir: string, dryRun = true) =>
  createExecutionContextFromEnv(undefined, {
    dryRun,
    allowWrite: false,
    rootDir
  });

const writeErrorLog = async (
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> => {
  const fullPath = join(rootDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
};

describe("review workflow", () => {
  it("returns repository context and validation results", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);

    const result = await runReviewWorkflow({
      context: createContext(rootDir),
      scope: "packages/core",
      workerId,
      validate: {
        typecheck: true
      }
    });

    expect(result.repositoryContext.scope).toBe("packages/core");
    expect(result.repositoryContext.packageMetadata?.scripts.typecheck).toContain("process.exit(0)");
    expect(result.validationReport.checks).toEqual([
      expect.objectContaining({
        name: "typecheck",
        status: "dry-run"
      })
    ]);
    expect(result.workerReviewResult).not.toBeNull();
    expect(result.reviewSummary.summary).toContain("Host-managed review");
    const summary = formatReviewWorkflowOutput(result) as {
      answerStatus?: string;
      debug?: {
        promptTransparency?: { hostPrompt?: string };
        workerMetadata?: Record<string, unknown>;
      };
      workflowStatus?: string;
    };
    expect(summary.workflowStatus).toBeTypeOf("string");
    expect(summary.answerStatus).toBeTypeOf("string");
    expect(summary.debug?.promptTransparency?.hostPrompt).toBeTypeOf("string");
    expect(summary.debug?.workerMetadata?.prompt).toBeTypeOf("string");
  });

  it("includes git diff context when requested", async () => {
    const rootDir = await createWorkspace(true);
    await registerWorker(rootDir);

    const result = await runReviewWorkflow({
      context: createContext(rootDir, false),
      includeDiff: true,
      workerId,
      scope: "packages/core"
    });

    expect(result.repositoryContext.gitDiff?.changedFiles).toContain("packages/core/src/index.ts");
  }, 15_000);

  it("ignores non-path scope text when explicit files are provided", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    await writeFile(
      join(rootDir, "package.json"),
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

    const result = await runReviewWorkflow({
      context: createContext(rootDir),
      files: ["packages/core/src/index.ts"],
      scope: "please focus on id generation only",
      workerId,
      validate: {
        typecheck: true
      }
    });

    expect(result.repositoryContext.scope).toBeUndefined();
    expect(result.repositoryContext.warnings.join("\n")).toContain("Ignoring scope");
    expect(result.validationReport.checks).toEqual([
      expect.objectContaining({
        name: "typecheck",
        status: "dry-run"
      })
    ]);
  });
});

describe("fix-error workflow", () => {
  it("accepts inline error logs and returns repository context", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      scope: "packages/core",
      workerId,
      validate: {
        typecheck: true
      }
    });

    expect(result.rootCauseAnalysis).toContain("supplied error log");
    expect(result.repositoryContext.scope).toBe("packages/core");
    expect(result.validationReport.checks).toEqual([
      expect.objectContaining({
        name: "typecheck",
        status: "dry-run"
      })
    ]);
  });

  it("reads error logs from files inside the repository root", async () => {
    const rootDir = await createWorkspace();
    await registerWorker(rootDir);
    await writeErrorLog(
      rootDir,
      "tmp/error.log",
      "TypeError: Cannot read properties of undefined\n"
    );

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLogFile: "tmp/error.log",
      workerId,
      scope: "packages/core"
    });

    expect(result.rootCauseAnalysis).toContain("supplied error log");
    expect(result.candidateFixPlan.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects traversal paths for error log files", async () => {
    const rootDir = await createWorkspace();

    await expect(
      runFixErrorWorkflow({
        context: createContext(rootDir),
        errorLogFile: "../outside.log"
      })
    ).rejects.toThrow("escapes the repository root");
  });
});
