import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv, listAuditEvents } from "@agent-orchestrator/core";

import { writeRepositoryFile } from "./write-file.js";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-write-file-"));

describe("writeRepositoryFile", () => {
  it("blocks unsafe paths", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await expect(
      writeRepositoryFile("../outside.txt", "blocked", context)
    ).rejects.toThrow("Write path escapes the repository root.");
  });

  it("returns dry-run for safe paths by default", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const result = await writeRepositoryFile("notes/output.txt", "hello", context);

    expect(result.written).toBe(false);
    expect(result.mode).toBe("dry-run");
  });

  it("writes safe paths when explicitly allowed", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = await writeRepositoryFile("notes/output.txt", "hello", context);
    const written = await readFile(join(rootDir, "notes", "output.txt"), "utf8");

    expect(result.written).toBe(true);
    expect(written).toBe("hello");
  });

  it("writes a blocked audit event when audit writing is allowed", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await expect(
      writeRepositoryFile("../outside.txt", "blocked", context)
    ).rejects.toThrow();
    const events = await listAuditEvents(rootDir, 10);

    expect(events.some((event) => event.action === "write-file" && event.mode === "blocked")).toBe(true);
  });
});
