import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  getAoWorkspaceRunsDir,
  createTaskSession,
  getTaskArtifactPath,
  getTaskSessionPath,
  listTaskSessions,
  readTaskArtifact,
  readTaskSession,
  scanTaskSessions,
  updateTaskSession,
  writeTaskArtifact
} from "@agent-orchestrator/core";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-task-session-"));

const createContext = (
  rootDir: string,
  options: { allowWrite?: boolean; dryRun?: boolean } = {}
) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    allowWrite: options.allowWrite ?? false,
    dryRun: options.dryRun ?? true
  });

describe("task session store", () => {
  it("creates dry-run sessions without writing files", async () => {
    const rootDir = await createWorkspace();
    const context = createContext(rootDir);
    const result = await createTaskSession(
      context,
      {
        goal: "Review packages/core"
      },
      false
    );

    expect(result.mode).toBe("dry-run");
    expect(await readTaskSession(rootDir, result.session.taskId)).toBeNull();
  });

  it("creates, updates, and reads persisted sessions and artifacts", async () => {
    const rootDir = await createWorkspace();
    const context = createContext(rootDir, {
      allowWrite: true,
      dryRun: false
    });
    const created = await createTaskSession(
      context,
      {
        goal: "Fix validation",
        scope: "packages/core"
      },
      true
    );

    created.session.status = "reviewed";
    created.session.steps.push({
      id: "review",
      name: "Repository review",
      status: "success",
      warnings: [],
      errors: []
    });
    const updated = await updateTaskSession(context, created.session, true);
    const artifact = await writeTaskArtifact(
      context,
      created.session.taskId,
      "review-result.json",
      {
        ok: true
      },
      true
    );
    const session = await readTaskSession(rootDir, created.session.taskId);
    const storedArtifact = await readTaskArtifact<{ ok: boolean }>(
      rootDir,
      created.session.taskId,
      "review-result.json"
    );

    expect(created.mode).toBe("execute");
    expect(updated.mode).toBe("execute");
    expect(artifact.mode).toBe("execute");
    expect(session?.status).toBe("reviewed");
    expect(session?.steps).toHaveLength(1);
    expect(storedArtifact.exists).toBe(true);
    expect(storedArtifact.value).toEqual({ ok: true });
    expect(updated.path).toBe(getTaskSessionPath(rootDir, created.session.taskId));
    expect(artifact.path).toBe(
      getTaskArtifactPath(rootDir, created.session.taskId, "review-result.json")
    );
  });

  it("lists sessions and reports invalid files", async () => {
    const rootDir = await createWorkspace();
    const context = createContext(rootDir, {
      allowWrite: true,
      dryRun: false
    });
    const older = await createTaskSession(
      context,
      {
        goal: "Older session"
      },
      true
    );
    const newer = await createTaskSession(
      context,
      {
        goal: "Newer session"
      },
      true
    );
    const runsDir = getAoWorkspaceRunsDir(rootDir);
    await mkdir(join(runsDir, "broken"), { recursive: true });
    await writeFile(
      join(runsDir, "broken", "session.json"),
      "{\"taskId\":42}",
      "utf8"
    );

    older.session.updatedAt = "2026-06-25T10:00:00.000Z";
    newer.session.updatedAt = "2026-06-25T11:00:00.000Z";
    await writeFile(
      getTaskSessionPath(rootDir, older.session.taskId),
      JSON.stringify(older.session, null, 2),
      "utf8"
    );
    await writeFile(
      getTaskSessionPath(rootDir, newer.session.taskId),
      JSON.stringify(newer.session, null, 2),
      "utf8"
    );

    const listed = await listTaskSessions(rootDir);
    const scanned = await scanTaskSessions(rootDir);

    expect(listed[0]?.taskId).toBe(newer.session.taskId);
    expect(scanned.invalidSessions).toHaveLength(1);
  });

  it("rejects unsafe task ids", async () => {
    const rootDir = await createWorkspace();
    const context = createContext(rootDir, {
      allowWrite: true,
      dryRun: false
    });

    await expect(
      writeTaskArtifact(context, "../bad", "review.json", {}, true)
    ).rejects.toThrow("Unsafe task id");
  });
});
