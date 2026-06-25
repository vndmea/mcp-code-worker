import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WritePolicy } from "@agent-orchestrator/core";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-path-safety-"));

describe("write path safety", () => {
  it("blocks traversal outside the repository root", async () => {
    const rootDir = await createRootDir();
    const policy = new WritePolicy({
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = policy.evaluate("../outside.txt");

    expect(result.mode).toBe("blocked");
  });

  it("blocks absolute paths outside the repository root", async () => {
    const rootDir = await createRootDir();
    const policy = new WritePolicy({
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = policy.evaluate(join(tmpdir(), "outside.txt"));

    expect(result.mode).toBe("blocked");
  });

  it("blocks secret-like files and git internals", async () => {
    const rootDir = await createRootDir();
    const policy = new WritePolicy({
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    expect(policy.evaluate(".env").mode).toBe("blocked");
    expect(policy.evaluate(".env.local").mode).toBe("blocked");
    expect(policy.evaluate(".git/config").mode).toBe("blocked");
    expect(policy.evaluate("id_rsa").mode).toBe("blocked");
  });

  it("returns dry-run for safe repository paths by default", async () => {
    const rootDir = await createRootDir();
    const policy = new WritePolicy({
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const result = policy.evaluate("notes/output.txt");

    expect(result.mode).toBe("dry-run");
    expect(result.allowed).toBe(true);
  });

  it("blocks symlink escapes when supported by the platform", async () => {
    const rootDir = await createRootDir();
    const outsideDir = await createRootDir();
    const linkPath = join(rootDir, "linked");

    try {
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, linkPath, "junction");
    } catch {
      return;
    }

    const policy = new WritePolicy({
      allowWrite: true,
      dryRun: false,
      rootDir
    });
    const result = policy.evaluate("linked/escape.txt");

    expect(result.mode).toBe("blocked");
  });
});
