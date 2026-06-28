import { mkdir, mkdtemp, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  getCwWorkspaceAuditDir,
  getCwWorkspaceRunsDir
} from "@mcp-code-worker/core";

import { resolveCleanupTargetPath } from "./cleanup.js";

const createWorkspace = async (): Promise<{
  auditDir: string;
  rootDir: string;
  runsDir: string;
}> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-cleanup-"));
  const env = {
    ...process.env,
    CW_STORAGE_DIR: join(rootDir, "cw-home")
  };
  const runsDir = getCwWorkspaceRunsDir(rootDir, env);
  const auditDir = getCwWorkspaceAuditDir(rootDir, env);
  await mkdir(runsDir, { recursive: true });
  await mkdir(auditDir, { recursive: true });
  return {
    rootDir,
    runsDir,
    auditDir
  };
};

describe("cleanup path safety", () => {
  it("accepts targets inside the allowed cleanup directory", async () => {
    const { runsDir } = await createWorkspace();
    const targetPath = join(runsDir, "task-1");
    await mkdir(targetPath, { recursive: true });

    const result = await resolveCleanupTargetPath(runsDir, targetPath);

    expect(result.deletePath).toBeTruthy();
    expect(result.warning).toBeUndefined();
  });

  it("accepts targets when the allowed directory resolves to the same real path", async () => {
    const { rootDir, runsDir } = await createWorkspace();
    const aliasedRunsDir = join(rootDir, "runs-alias");
    const targetPath = join(aliasedRunsDir, "task-1");
    await mkdir(join(runsDir, "task-1"), { recursive: true });
    await symlink(
      runsDir,
      aliasedRunsDir,
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await resolveCleanupTargetPath(aliasedRunsDir, targetPath);

    expect(result.deletePath).toBeTruthy();
    expect(result.warning).toBeUndefined();
  });

  it("rejects protected .cw files", async () => {
    const { rootDir } = await createWorkspace();
    const protectedDir = join(rootDir, "cw-home", "protected");
    const targetPath = join(protectedDir, "config.json");
    await mkdir(protectedDir, { recursive: true });
    await writeFile(targetPath, "{}", "utf8");

    const result = await resolveCleanupTargetPath(join(rootDir, "cw-home"), targetPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("protected");
  });

  it("rejects paths that escape the allowed cleanup directory", async () => {
    const { rootDir, runsDir } = await createWorkspace();
    const targetPath = join(rootDir, "outside.txt");
    await writeFile(targetPath, "outside", "utf8");

    const result = await resolveCleanupTargetPath(runsDir, targetPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("unsafe cleanup target");
  });

  it("rejects symlinked run targets that resolve outside the allowed directory", async () => {
    const { rootDir, runsDir } = await createWorkspace();
    const outsideDir = join(rootDir, "outside");
    const symlinkPath = join(runsDir, "task-link");
    await mkdir(outsideDir, { recursive: true });
    await symlink(
      outsideDir,
      symlinkPath,
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await resolveCleanupTargetPath(runsDir, symlinkPath);

    expect(result.deletePath).toBeUndefined();
    expect(result.warning).toContain("unsafe cleanup target");
  });
});
