import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv, listAuditEvents } from "@agent-orchestrator/core";

import { runSafeCommand } from "./safe-command.js";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-safe-command-"));

describe("runSafeCommand", () => {
  it("returns dry-run for allowed commands by default", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const result = await runSafeCommand("node noop.js", context);

    expect(result.mode).toBe("dry-run");
  });

  it("blocks dangerous commands", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await expect(runSafeCommand("curl https://example.com", context)).rejects.toThrow(
      "blocked as dangerous"
    );
  });

  it("blocks shell metacharacter injection", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await expect(runSafeCommand("node script.js && git status", context)).rejects.toThrow(
      "blocked shell metacharacters"
    );
  });

  it("times out long-running commands", async () => {
    const rootDir = await createRootDir();
    const scriptPath = join(rootDir, "timeout-script.js");
    await writeFile(
      scriptPath,
      'setTimeout(() => { console.log("late"); }, 1000);',
      "utf8"
    );
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = await runSafeCommand(`node ${scriptPath}`, context, {
      timeoutMs: 50
    });

    expect(result.timedOut).toBe(true);
  });

  it("truncates large stdout output", async () => {
    const rootDir = await createRootDir();
    const scriptPath = join(rootDir, "stdout-script.js");
    await writeFile(
      scriptPath,
      'process.stdout.write("a".repeat(1000));',
      "utf8"
    );
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = await runSafeCommand(`node ${scriptPath}`, context, {
      maxOutputBytes: 50
    });

    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(50);
  });

  it("writes a blocked audit event when command execution is blocked", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    await expect(runSafeCommand("curl https://example.com", context)).rejects.toThrow();
    const events = await listAuditEvents(rootDir, 10);

    expect(events.some((event) => event.action === "run-command" && event.mode === "blocked")).toBe(true);
  });
});
