import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { readGitDiff } from "@agent-orchestrator/tools";

const execFile = promisify(execFileCallback);

const createGitRoot = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-git-diff-"));
  await execFile("git", ["init"], { cwd: rootDir });
  await execFile("git", ["config", "user.email", "ao@example.com"], { cwd: rootDir });
  await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: rootDir });
  return rootDir;
};

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    dryRun: false,
    allowWrite: false,
    rootDir
  });

describe("readGitDiff", () => {
  it("returns an empty diff summary for a clean repository", async () => {
    const rootDir = await createGitRoot();
    await writeFile(join(rootDir, "demo.ts"), "export const value = 1;\n", "utf8");
    await execFile("git", ["add", "demo.ts"], { cwd: rootDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });

    const result = await readGitDiff(createContext(rootDir), {});

    expect(result.changedFiles).toEqual([]);
    expect(result.diffText).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("supports base and head refs and extracts changed files", async () => {
    const rootDir = await createGitRoot();
    await writeFile(join(rootDir, "demo.ts"), "export const value = 1;\n", "utf8");
    await execFile("git", ["add", "demo.ts"], { cwd: rootDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });
    await writeFile(join(rootDir, "demo.ts"), "export const value = 2;\n", "utf8");
    await execFile("git", ["commit", "-am", "update"], { cwd: rootDir });

    const result = await readGitDiff(createContext(rootDir), {
      base: "HEAD~1",
      head: "HEAD"
    });

    expect(result.base).toBe("HEAD~1");
    expect(result.head).toBe("HEAD");
    expect(result.changedFiles).toContain("demo.ts");
    expect(result.diffText).toContain("export const value = 2");
  }, 15_000);

  it("rejects unsafe refs", async () => {
    const rootDir = await createGitRoot();

    await expect(
      readGitDiff(createContext(rootDir), {
        base: "main && rm -rf ."
      })
    ).rejects.toThrow("Unsafe git ref");
  });

  it("reads large diffs without a byte budget", async () => {
    const rootDir = await createGitRoot();
    await writeFile(join(rootDir, "demo.ts"), "export const value = 1;\n", "utf8");
    await execFile("git", ["add", "demo.ts"], { cwd: rootDir });
    await execFile("git", ["commit", "-m", "initial"], { cwd: rootDir });
    await writeFile(join(rootDir, "demo.ts"), `${"line\n".repeat(200)}\n`, "utf8");

    const result = await readGitDiff(createContext(rootDir));

    expect(result.truncated).toBe(false);
    expect(result.diffText.length).toBeGreaterThan(50);
    expect(result.changedFiles).toContain("demo.ts");
  });
});
