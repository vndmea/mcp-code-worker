import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import {
  buildRepositoryContextPack,
  selectRepositoryFiles
} from "@agent-orchestrator/tools";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-repository-context-"));

const writeText = async (
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> => {
  const fullPath = join(rootDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
};

describe("repository context pack", () => {
  it("builds scoped context packs with package metadata", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      dryRun: true,
      allowWrite: false,
      rootDir
    });

    await writeText(
      rootDir,
      "packages/pkg/package.json",
      JSON.stringify(
        {
          packageManager: "pnpm@10.0.0",
          scripts: {
            typecheck: "node -e \"process.exit(0)\""
          }
        },
        null,
        2
      )
    );
    await writeText(rootDir, "packages/pkg/src/index.ts", "export const value = 1;\n");
    await writeText(rootDir, "packages/other/src/hidden.ts", "export const hidden = true;\n");

    const result = await buildRepositoryContextPack(context, {
      rootDir,
      scope: "packages/pkg"
    });

    expect(result.scope).toBe("packages/pkg");
    expect(result.selectedFiles.length).toBeGreaterThan(0);
    expect(result.selectedFiles.every((file) => file.path.startsWith("packages/pkg/"))).toBe(true);
    expect(result.selectionReasons.length).toBeGreaterThan(0);
    expect(result.packageMetadata?.packageJsonPath).toBe("packages/pkg/package.json");
    expect(result.packageMetadata?.scripts.typecheck).toContain("process.exit(0)");
  });

  it("excludes secret-like files and ignored directories", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, ".env", "SECRET=1\n");
    await writeText(rootDir, "node_modules/demo/index.js", "export default 1;\n");
    await writeText(rootDir, "src/index.ts", "export const safe = true;\n");

    const result = await selectRepositoryFiles({
      rootDir
    });

    expect(result.files.some((file) => file.path === ".env")).toBe(false);
    expect(result.files.some((file) => file.path.includes("node_modules"))).toBe(false);
    expect(result.selectedFiles.some((file) => file.path === "src/index.ts")).toBe(true);
  });

  it("truncates large files and enforces max total bytes", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, "large-a.txt", "a".repeat(80));
    await writeText(rootDir, "large-b.txt", "b".repeat(80));

    const result = await selectRepositoryFiles({
      rootDir,
      files: ["large-a.txt", "large-b.txt"],
      maxFileBytes: 20,
      maxTotalBytes: 25
    });

    expect(result.selectedFiles[0]?.truncated).toBe(true);
    expect(result.selectedFiles[0]?.content.length).toBeLessThanOrEqual(20);
    expect(result.selectedFiles).toHaveLength(2);
    expect(
      result.warnings.some((warning) => warning.includes("explicitly requested"))
    ).toBe(true);
  });

  it("fails fast in strict file mode when explicit files exceed max total bytes", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, "large-a.txt", "a".repeat(80));
    await writeText(rootDir, "large-b.txt", "b".repeat(80));

    await expect(
      selectRepositoryFiles({
        rootDir,
        files: ["large-a.txt", "large-b.txt"],
        maxFileBytes: 20,
        maxTotalBytes: 25,
        strictFiles: true
      })
    ).rejects.toMatchObject({
      code: "REPOSITORY_CONTEXT_LIMIT_EXCEEDED",
      details: {
        path: "large-b.txt",
        strictFiles: true
      }
    });
  });

  it("rejects path traversal when selecting files", async () => {
    const rootDir = await createRootDir();

    await expect(
      selectRepositoryFiles({
        rootDir,
        files: ["../outside.txt"]
      })
    ).rejects.toThrow("escapes the repository root");
  });

  it("allows explicit files that stay inside the provided scope", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, "packages/pkg/src/index.ts", "export const value = 1;\n");
    await writeText(rootDir, "packages/pkg/src/helper.ts", "export const helper = true;\n");

    const result = await selectRepositoryFiles({
      rootDir,
      scope: "packages/pkg",
      files: ["packages/pkg/src/index.ts", "packages/pkg/src/helper.ts"]
    });

    expect(result.selectedFiles).toHaveLength(2);
    expect(result.selectedFiles.every((file) => file.path.startsWith("packages/pkg/"))).toBe(true);
  });

  it("ignores non-path scope strings when explicit files are provided", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, "packages/pkg/src/index.ts", "export const value = 1;\n");

    const result = await selectRepositoryFiles({
      rootDir,
      scope: "please only inspect this file and stay narrow",
      files: ["packages/pkg/src/index.ts"]
    });

    expect(result.effectiveScope).toBeUndefined();
    expect(result.selectedFiles.map((file) => file.path)).toEqual([
      "packages/pkg/src/index.ts"
    ]);
    expect(
      result.warnings.some((warning) => warning.includes("Ignoring scope"))
    ).toBe(true);
  });

  it("blocks explicit files outside the provided scope with a stable error code", async () => {
    const rootDir = await createRootDir();

    await writeText(rootDir, "packages/pkg/src/index.ts", "export const value = 1;\n");
    await writeText(rootDir, "packages/other/src/hidden.ts", "export const hidden = true;\n");

    await expect(
      selectRepositoryFiles({
        rootDir,
        scope: "packages/pkg",
        files: ["packages/other/src/hidden.ts"]
      })
    ).rejects.toMatchObject({
      code: "REPOSITORY_SCOPE_BLOCKED",
      details: {
        path: "packages/other/src/hidden.ts",
        scope: "packages/pkg"
      }
    });
  });

  it("still blocks root escapes before applying scope checks", async () => {
    const rootDir = await createRootDir();

    await expect(
      selectRepositoryFiles({
        rootDir,
        scope: "packages/pkg",
        files: ["../outside.txt"]
      })
    ).rejects.toMatchObject({
      code: "REPOSITORY_PATH_BLOCKED",
      details: {
        path: "../outside.txt"
      }
    });
  });

  it("uses context budget defaults from execution context", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      contextBudget: {
        maxFileBytes: 12,
        maxTotalBytes: 20,
        ignoredPaths: ["generated"]
      },
      rootDir
    });

    await writeText(rootDir, "src/index.ts", "export const value = 12345;\n");
    await writeText(rootDir, "generated/skip.ts", "export const skipped = true;\n");

    const result = await buildRepositoryContextPack(context, {
      rootDir
    });

    expect(result.selectedFiles[0]?.truncated).toBe(true);
    expect(result.selectedFiles[0]?.content.length).toBeLessThanOrEqual(12);
    expect(result.files.some((file) => file.path === "generated/skip.ts")).toBe(false);
  });

  it("lets explicit max options override context budget", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      contextBudget: {
        maxFileBytes: 8,
        maxTotalBytes: 16,
        ignoredPaths: []
      },
      rootDir
    });

    await writeText(rootDir, "src/index.ts", "export const expanded = 12345;\n");

    const result = await buildRepositoryContextPack(context, {
      rootDir,
      maxFileBytes: 40,
      maxTotalBytes: 80
    });

    expect(result.selectedFiles[0]?.truncated).toBe(false);
    expect(result.selectedFiles[0]?.content.length).toBeGreaterThan(8);
  });

  it("records skipped files and a coverage gap when ranked context exceeds budget", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      dryRun: true,
      allowWrite: false,
      rootDir
    });

    await writeText(rootDir, "src/a.ts", "export const a = '".concat("a".repeat(60), "';\n"));
    await writeText(rootDir, "src/b.ts", "export const b = '".concat("b".repeat(60), "';\n"));
    await writeText(rootDir, "src/c.ts", "export const c = '".concat("c".repeat(60), "';\n"));

    const result = await buildRepositoryContextPack(context, {
      rootDir,
      maxFileBytes: 200,
      maxTotalBytes: 90
    });

    expect(result.coverageGapDetected).toBe(true);
    expect(result.skippedFiles.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("Skipping"))).toBe(true);
  });

  it("ranks files using error-log matches, dependency hints, and selection reasons", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      rootDir
    });

    await writeText(
      rootDir,
      "packages/pkg/src/index.ts",
      'import { helper } from "./helper";\nexport const value = helper();\n'
    );
    await writeText(
      rootDir,
      "packages/pkg/src/helper.ts",
      "export const helper = () => 1;\n"
    );
    await writeText(
      rootDir,
      "packages/pkg/src/helper.test.ts",
      'import { helper } from "./helper";\nexpect(helper()).toBe(1);\n'
    );

    const result = await buildRepositoryContextPack(context, {
      rootDir,
      scope: "packages/pkg",
      errorLog: "TS2304 in packages/pkg/src/helper.ts:1:1"
    });

    expect(result.selectedFiles[0]?.path).toBe("packages/pkg/src/helper.ts");
    expect(result.selectionReasons[0]?.path).toBe("packages/pkg/src/helper.ts");
    expect(result.selectionReasons[0]?.reason).toContain("error log");
    expect(
      result.selectionReasons.some((entry) => entry.path === "packages/pkg/src/helper.test.ts")
    ).toBe(true);
  });
});
