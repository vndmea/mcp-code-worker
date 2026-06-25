import { mkdir, mkdtemp, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveCleanupTargetPath } from "./cleanup.js";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-cleanup-"));
  await mkdir(join(rootDir, ".ao", "runs"), { recursive: true });
  await mkdir(join(rootDir, ".ao", "audit"), { recursive: true });
  return rootDir;
};

describe("cleanup path safety", () => {
  it("accepts targets inside the allowed cleanup directory", async () => {
    const rootDir = await createWorkspace();
    const targetPath = join(rootDir, ".ao", "runs", "task-1");
    await mkdir(targetPath, { recursive: true });

    const result = await resolveCleanupTargetPath(rootDir, "runs", targetPath);

    expect(result.deletePath).toBeTruthy();
    expect(result.warning).toBeUndefined();
  });

  it("rejects protected .ao files", async () => {
    const rootDir = await createWorkspace();
    const targetPath = join(rootDir, ".ao", "config.json");
    await writeFile(targetPath, "{}", "utf8");

    const result = await resolveCleanupTargetPath(rootDir, "runs", targetPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("protected");
  });

  it("rejects paths that escape the allowed cleanup directory", async () => {
    const rootDir = await createWorkspace();
    const targetPath = join(rootDir, "outside.txt");
    await writeFile(targetPath, "outside", "utf8");

    const result = await resolveCleanupTargetPath(rootDir, "runs", targetPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("unsafe cleanup target");
  });

  it("rejects symlinked run targets that resolve outside the allowed directory", async () => {
    const rootDir = await createWorkspace();
    const outsideDir = join(rootDir, "outside");
    const symlinkPath = join(rootDir, ".ao", "runs", "task-link");
    await mkdir(outsideDir, { recursive: true });
    await symlink(
      outsideDir,
      symlinkPath,
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await resolveCleanupTargetPath(rootDir, "runs", symlinkPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("unsafe cleanup target");
  });
});
