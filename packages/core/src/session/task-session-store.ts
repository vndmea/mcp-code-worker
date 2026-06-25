import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { AgentError } from "../errors/agent-error.js";
import type { ExecutionContext } from "../runtime/execution-context.js";
import { TaskSessionSchema, type TaskSession } from "../schemas/task-session.schema.js";
import { writeAuditEvent } from "../audit/audit-log.js";

export interface CreateTaskSessionInput {
  goal: string;
  metadata?: Record<string, unknown>;
  requireProfile?: boolean;
  scope?: string;
  workerId?: string;
}

export interface TaskSessionWriteResult {
  mode: "execute" | "dry-run";
  path: string;
}

export interface ScanTaskSessionsResult {
  invalidSessions: Array<{ error: string; path: string }>;
  sessions: TaskSession[];
}

export interface TaskArtifactReadResult<T = unknown> {
  exists: boolean;
  path: string;
  value: T | string | null;
}

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const ensureTaskId = (taskId: string): string => {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new AgentError("TASK_ID_BLOCKED", `Unsafe task id: ${taskId}`, {
      taskId
    });
  }

  return taskId;
};

const ensureArtifactName = (artifactName: string): string => {
  if (!SAFE_ARTIFACT_NAME.test(artifactName)) {
    throw new AgentError(
      "TASK_ARTIFACT_NAME_BLOCKED",
      `Unsafe artifact name: ${artifactName}`,
      { artifactName }
    );
  }

  return artifactName;
};

export const getTaskRunsDirectory = (rootDir: string): string =>
  join(rootDir, ".ao", "runs");

export const getTaskSessionDirectory = (
  rootDir: string,
  taskId: string
): string =>
  join(getTaskRunsDirectory(rootDir), ensureTaskId(taskId));

export const getTaskSessionPath = (
  rootDir: string,
  taskId: string
): string =>
  join(getTaskSessionDirectory(rootDir, taskId), "session.json");

export const getTaskArtifactPath = (
  rootDir: string,
  taskId: string,
  artifactName: string
): string =>
  join(
    getTaskSessionDirectory(rootDir, taskId),
    ensureArtifactName(artifactName)
  );

const createTaskId = (): string =>
  `task-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;

const sortSessions = (sessions: TaskSession[]): TaskSession[] =>
  [...sessions].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );

const parseTaskSession = (contents: string, path: string): TaskSession => {
  const parsed = TaskSessionSchema.safeParse(JSON.parse(contents) as unknown);

  if (!parsed.success) {
    throw new AgentError(
      "TASK_SESSION_INVALID",
      parsed.error.issues.map((issue) => issue.message).join("; "),
      { path }
    );
  }

  return parsed.data;
};

const createTaskSessionValue = (input: CreateTaskSessionInput): TaskSession => {
  const now = new Date().toISOString();

  return TaskSessionSchema.parse({
    taskId: createTaskId(),
    goal: input.goal,
    scope: input.scope,
    workerId: input.workerId,
    requireProfile: input.requireProfile ?? false,
    status: "created",
    createdAt: now,
    updatedAt: now,
    steps: [],
    artifacts: {},
    warnings: [],
    errors: [],
    metadata: input.metadata ?? {}
  });
};

const writeSessionAuditEvent = async (
  context: ExecutionContext,
  action: string,
  mode: "execute" | "dry-run",
  taskId: string,
  metadata: Record<string, unknown>
): Promise<void> => {
  await writeAuditEvent(
    context,
    {
      actor: "workflow",
      action,
      mode,
      inputSummary: taskId,
      outputSummary: `${action} completed for ${taskId}.`,
      warnings: [],
      errors: [],
      metadata
    },
    true
  );
};

const writeManagedFile = async (
  context: ExecutionContext,
  path: string,
  content: string,
  explicitAllowWrite: boolean
): Promise<{ mode: "execute" | "dry-run"; normalizedPath: string }> => {
  const evaluation = context.writePolicy.evaluate(path, explicitAllowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      path: evaluation.normalizedPath
    });
  }

  if (evaluation.mode === "dry-run") {
    return {
      mode: "dry-run",
      normalizedPath: evaluation.normalizedPath
    };
  }

  await mkdir(dirname(evaluation.normalizedPath), { recursive: true });
  await writeFile(evaluation.normalizedPath, content, "utf8");

  return {
    mode: "execute",
    normalizedPath: evaluation.normalizedPath
  };
};

export async function createTaskSession(
  context: ExecutionContext,
  input: CreateTaskSessionInput,
  explicitAllowWrite = false
): Promise<{ mode: "execute" | "dry-run"; path: string; session: TaskSession }> {
  const session = createTaskSessionValue(input);
  const path = getTaskSessionPath(context.rootDir, session.taskId);
  const result = await writeManagedFile(
    context,
    path,
    JSON.stringify(session, null, 2),
    explicitAllowWrite
  );

  await writeSessionAuditEvent(
    context,
    "create-task-session",
    result.mode,
    session.taskId,
    { path: result.normalizedPath }
  );

  return {
    mode: result.mode,
    path: result.normalizedPath,
    session
  };
}

export async function readTaskSession(
  rootDir: string,
  taskId: string
): Promise<TaskSession | null> {
  const path = getTaskSessionPath(rootDir, taskId);

  try {
    const contents = await readFile(path, "utf8");
    return parseTaskSession(contents, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/u.test(message)) {
      return null;
    }

    throw error;
  }
}

export async function updateTaskSession(
  context: ExecutionContext,
  session: TaskSession,
  explicitAllowWrite = false
): Promise<TaskSessionWriteResult> {
  const nextSession = TaskSessionSchema.parse({
    ...session,
    taskId: ensureTaskId(session.taskId),
    updatedAt: new Date().toISOString()
  });
  const path = getTaskSessionPath(context.rootDir, nextSession.taskId);
  const result = await writeManagedFile(
    context,
    path,
    JSON.stringify(nextSession, null, 2),
    explicitAllowWrite
  );

  await writeSessionAuditEvent(
    context,
    "update-task-session",
    result.mode,
    nextSession.taskId,
    { path: result.normalizedPath, status: nextSession.status }
  );

  Object.assign(session, nextSession);

  return {
    mode: result.mode,
    path: result.normalizedPath
  };
}

export async function writeTaskArtifact(
  context: ExecutionContext,
  taskId: string,
  artifactName: string,
  artifact: unknown,
  explicitAllowWrite = false
): Promise<TaskSessionWriteResult> {
  const safeTaskId = ensureTaskId(taskId);
  const safeArtifactName = ensureArtifactName(artifactName);
  const path = getTaskArtifactPath(context.rootDir, safeTaskId, safeArtifactName);
  const content =
    typeof artifact === "string"
      ? artifact
      : JSON.stringify(artifact, null, 2);
  const result = await writeManagedFile(
    context,
    path,
    content,
    explicitAllowWrite
  );

  await writeSessionAuditEvent(
    context,
    "write-task-artifact",
    result.mode,
    safeTaskId,
    {
      artifactName: safeArtifactName,
      path: result.normalizedPath
    }
  );

  return {
    mode: result.mode,
    path: result.normalizedPath
  };
}

export async function scanTaskSessions(
  rootDir: string
): Promise<ScanTaskSessionsResult> {
  const runsDir = getTaskRunsDirectory(rootDir);

  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    const sessions: TaskSession[] = [];
    const invalidSessions: Array<{ error: string; path: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const path = getTaskSessionPath(rootDir, entry.name);

      try {
        const contents = await readFile(path, "utf8");
        sessions.push(parseTaskSession(contents, path));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT/u.test(message)) {
          continue;
        }

        invalidSessions.push({
          path,
          error: message
        });
      }
    }

    return {
      sessions: sortSessions(sessions),
      invalidSessions
    };
  } catch {
    return {
      sessions: [],
      invalidSessions: []
    };
  }
}

export async function listTaskSessions(
  rootDir: string,
  limit = 50
): Promise<TaskSession[]> {
  const result = await scanTaskSessions(rootDir);
  return result.sessions.slice(0, limit);
}

export async function readTaskArtifact<T = unknown>(
  rootDir: string,
  taskId: string,
  artifactName: string
): Promise<TaskArtifactReadResult<T>> {
  const path = getTaskArtifactPath(rootDir, taskId, artifactName);

  try {
    const contents = await readFile(path, "utf8");
    try {
      return {
        exists: true,
        path,
        value: JSON.parse(contents) as T
      };
    } catch {
      return {
        exists: true,
        path,
        value: contents
      };
    }
  } catch {
    return {
      exists: false,
      path,
      value: null
    };
  }
}
