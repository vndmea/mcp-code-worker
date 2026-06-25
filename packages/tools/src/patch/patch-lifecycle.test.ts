import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  PatchProposalSchema
} from "@agent-orchestrator/core";
import {
  applyPatchProposal,
  inspectPatch,
  parseUnifiedDiff
} from "@agent-orchestrator/tools";

const execFile = promisify(execFileCallback);

const createGitRoot = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-patch-lifecycle-"));
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "node -e \"process.exit(0)\"",
          lint: "node -e \"console.error('lint failed'); process.exit(1)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(join(rootDir, "demo.ts"), "export const value = 1;\n", "utf8");
  await execFile("git", ["init"], { cwd: rootDir });
  await execFile("git", ["config", "user.email", "ao@example.com"], { cwd: rootDir });
  await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: rootDir });
  await execFile("git", ["add", "."], { cwd: rootDir });
  await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });
  return rootDir;
};

const createProposal = (diffText: string, path = "demo.ts") =>
  PatchProposalSchema.parse({
    id: "patch-1",
    title: "Add a candidate comment",
    summary: "Add a review comment above the export.",
    rationale: ["Used for patch lifecycle tests."],
    unifiedDiff: diffText,
    files: [
      {
        path,
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

const createValidProposal = async (
  rootDir: string,
  path = "demo.ts"
): Promise<ReturnType<typeof createProposal>> => {
  const fullPath = join(rootDir, path);
  const originalContents = "export const value = 1;\n";
  await writeFile(fullPath, `// comment\n${originalContents}`, "utf8");
  const diff = await execFile("git", ["diff", "--", path], {
    cwd: rootDir
  });
  await writeFile(fullPath, originalContents, "utf8");

  return createProposal(diff.stdout, path);
};

const createContext = (rootDir: string, allowWrite = false) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    dryRun: false,
    allowWrite
  });

describe("patch lifecycle tools", () => {
  it("parses add, modify, and delete unified diffs", () => {
    const diffText = [
      "diff --git a/demo.ts b/demo.ts",
      "--- a/demo.ts",
      "+++ b/demo.ts",
      "@@ -1,1 +1,2 @@",
      "+// comment",
      " export const value = 1;",
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+export const created = true;",
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-export const old = true;"
    ].join("\n");

    expect(parseUnifiedDiff(diffText)).toEqual([
      {
        path: "demo.ts",
        changeType: "modify",
        additions: 1,
        deletions: 0
      },
      {
        path: "new.ts",
        changeType: "add",
        additions: 1,
        deletions: 0
      },
      {
        path: "old.ts",
        changeType: "delete",
        additions: 0,
        deletions: 1
      }
    ]);
  });

  it("inspects safe patches and blocks unsafe targets", async () => {
    const rootDir = await createGitRoot();
    const context = createContext(rootDir);
    const safeProposal = await createValidProposal(rootDir);

    const safeInspection = await inspectPatch(context, safeProposal);
    const traversalInspection = await inspectPatch(
      context,
      createProposal(
        [
          "diff --git a/../outside.ts b/../outside.ts",
          "--- a/../outside.ts",
          "+++ b/../outside.ts",
          "@@ -0,0 +1 @@",
          "+export const blocked = true;"
        ].join("\n"),
        "../outside.ts"
      )
    );
    const secretInspection = await inspectPatch(
      context,
      createProposal(
        [
          "diff --git a/.env b/.env",
          "--- a/.env",
          "+++ b/.env",
          "@@ -1 +1 @@",
          "-SECRET=1",
          "+SECRET=2"
        ].join("\n"),
        ".env"
      )
    );

    expect(safeInspection.ok).toBe(true);
    expect(traversalInspection.ok).toBe(false);
    expect(secretInspection.ok).toBe(false);
  });

  it("blocks .git paths and empty diffs", async () => {
    const rootDir = await createGitRoot();
    const context = createContext(rootDir);
    const gitInspection = await inspectPatch(
      context,
      createProposal(
        [
          "diff --git a/.git/config b/.git/config",
          "--- a/.git/config",
          "+++ b/.git/config",
          "@@ -1 +1 @@",
          "-old",
          "+new"
        ].join("\n"),
        ".git/config"
      )
    );
    const emptyInspection = await inspectPatch(
      context,
      {
        ...createProposal("diff --git a/demo.ts b/demo.ts", "demo.ts"),
        unifiedDiff: ""
      }
    );

    expect(gitInspection.ok).toBe(false);
    expect(emptyInspection.ok).toBe(false);
  });

  it("supports dry-run patch application and blocks missing confirmation", async () => {
    const rootDir = await createGitRoot();
    const proposal = await createValidProposal(rootDir);

    const dryRunResult = await applyPatchProposal(
      createContext(rootDir),
      proposal,
      {
        dryRun: true
      }
    );
    const blockedResult = await applyPatchProposal(
      createContext(rootDir, true),
      proposal,
      {
        allowWrite: true,
        confirmApply: false,
        dryRun: false
      }
    );

    expect(dryRunResult.mode).toBe("dry-run");
    expect(dryRunResult.applied).toBe(false);
    expect(blockedResult.mode).toBe("blocked");
    expect(blockedResult.errors[0]).toContain("confirm");
  });

  it("applies valid patches only with explicit gates and can run validation", async () => {
    const rootDir = await createGitRoot();
    const proposal = await createValidProposal(rootDir);

    const result = await applyPatchProposal(
      createContext(rootDir, true),
      proposal,
      {
        allowWrite: true,
        confirmApply: true,
        dryRun: false,
        runValidation: {
          typecheck: true,
          lint: true
        }
      }
    );

    const contents = await execFile("git", ["diff", "--", "demo.ts"], {
      cwd: rootDir
    });

    expect(result.mode).toBe("execute");
    expect(result.applied).toBe(true);
    expect(result.validationReport?.ok).toBe(false);
    expect(result.warnings).toContain(
      "Patch applied but validation failed; manual review required."
    );
    expect(contents.stdout).toContain("// comment");
  });
});
