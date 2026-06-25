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
    expect(result.selectedFiles).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("maxTotalBytes"))).toBe(true);
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
});
