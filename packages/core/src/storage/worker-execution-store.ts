import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { AgentError } from "../errors/agent-error.js";
import type { ExecutionContext } from "../runtime/execution-context.js";
import {
  WorkerTaskExecutionRecordSchema,
  type WorkerResultEnvelope,
  type WorkerTaskEnvelope,
  type WorkerTaskExecutionRecord
} from "../schemas/worker-task-envelope.schema.js";
import type { WorkerTrustProfile } from "../types/agent.js";
import { getCwWorkspaceDir } from "./cw-paths.js";
import {
  bootstrapSqliteWorkspaceStore,
  openSqliteWorkspaceStore
} from "./sqlite.js";

export interface RecordWorkerTaskExecutionInput {
  artifactRefs?: string[];
  completedAt?: string;
  createdAt?: string;
  diagnostics?: Record<string, unknown>;
  id?: string;
  resultEnvelope?: WorkerResultEnvelope;
  taskEnvelope: WorkerTaskEnvelope;
  workerId?: string;
  workerTrustProfile: WorkerTrustProfile;
}

export interface WorkerTaskExecutionWriteResult {
  mode: "execute" | "dry-run";
  path: string;
  record: WorkerTaskExecutionRecord;
  written: boolean;
}

const EXECUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const ensureExecutionId = (executionId: string): string => {
  if (!EXECUTION_ID_PATTERN.test(executionId)) {
    throw new AgentError(
      "WORKER_EXECUTION_ID_BLOCKED",
      `Unsafe worker execution id: ${executionId}`,
      { executionId }
    );
  }

  return executionId;
};

const resolveStorageDir = (
  rootDir: string,
  cwStorageDir?: string
): string => cwStorageDir ?? getCwWorkspaceDir(rootDir);

export const getWorkerTaskExecutionsPath = (
  rootDir: string,
  cwStorageDir?: string
): string =>
  resolve(resolveStorageDir(rootDir, cwStorageDir), "data.db#worker_task_executions");

export const getWorkerTaskExecutionPath = (
  rootDir: string,
  executionId: string,
  cwStorageDir?: string
): string =>
  `${getWorkerTaskExecutionsPath(rootDir, cwStorageDir)}/${ensureExecutionId(executionId)}`;

const buildRecord = (
  input: RecordWorkerTaskExecutionInput
): WorkerTaskExecutionRecord => {
  const now = new Date().toISOString();

  return WorkerTaskExecutionRecordSchema.parse({
    id: input.id ?? `worker-exec-${randomUUID()}`,
    taskEnvelope: input.taskEnvelope,
    resultEnvelope: input.resultEnvelope,
    workerId: input.workerId,
    workerTrustProfile: input.workerTrustProfile,
    status: input.resultEnvelope?.status ?? "host_takeover",
    diagnostics: input.diagnostics ?? {},
    artifactRefs: input.artifactRefs ?? [],
    createdAt: input.createdAt ?? now,
    completedAt: input.completedAt ?? now
  });
};

const hydrateRecord = (row: {
  artifact_refs_json: string;
  completed_at: string | null;
  created_at: string;
  diagnostics_json: string;
  id: string;
  result_envelope_json: string | null;
  status: WorkerTaskExecutionRecord["status"];
  task_envelope_json: string;
  worker_id: string | null;
  worker_trust_json: string;
}): WorkerTaskExecutionRecord =>
  WorkerTaskExecutionRecordSchema.parse({
    id: row.id,
    taskEnvelope: JSON.parse(row.task_envelope_json) as unknown,
    resultEnvelope: row.result_envelope_json
      ? JSON.parse(row.result_envelope_json) as unknown
      : undefined,
    workerId: row.worker_id ?? undefined,
    workerTrustProfile: JSON.parse(row.worker_trust_json) as unknown,
    status: row.status,
    diagnostics: JSON.parse(row.diagnostics_json) as Record<string, unknown>,
    artifactRefs: JSON.parse(row.artifact_refs_json) as string[],
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined
  });

const recordArtifactRefs = (
  db: Awaited<ReturnType<typeof openSqliteWorkspaceStore>>,
  record: WorkerTaskExecutionRecord,
  executionPath: string
): void => {
  db.prepare("DELETE FROM artifact_records WHERE execution_id = ?").run(record.id);

  for (const [index, artifactRef] of record.artifactRefs.entries()) {
    db.prepare(
      `INSERT INTO artifact_records(
         id,
         task_id,
         execution_id,
         artifact_name,
         artifact_kind,
         storage,
         path,
         retention_class,
         metadata_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `${record.id}:artifact-${index}`,
      record.taskEnvelope.id,
      record.id,
      artifactRef,
      "worker-output",
      "sqlite-reference",
      `${executionPath}/artifacts/${index}`,
      "execution",
      JSON.stringify({ artifactRef }),
      record.createdAt
    );
  }
};

export const recordWorkerTaskExecution = async (
  context: ExecutionContext,
  input: RecordWorkerTaskExecutionInput,
  explicitAllowWrite = false
): Promise<WorkerTaskExecutionWriteResult> => {
  const record = buildRecord(input);
  const path = getWorkerTaskExecutionPath(
    context.rootDir,
    record.id,
    context.cwStorageDir
  );
  const evaluation = context.storageWritePolicy.evaluate(
    "execution-record-write",
    explicitAllowWrite
  );

  if (evaluation.mode !== "execute") {
    return {
      mode: "dry-run",
      path,
      record,
      written: false
    };
  }

  const storageDir = resolveStorageDir(context.rootDir, context.cwStorageDir);
  await bootstrapSqliteWorkspaceStore(storageDir);
  const db = await openSqliteWorkspaceStore(storageDir);

  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO worker_task_executions(
         id,
         task_id,
         task_type,
         host,
         contract_id,
         contract_version,
         worker_id,
         worker_trust_json,
         task_envelope_json,
         result_envelope_json,
         status,
         diagnostics_json,
         artifact_refs_json,
         created_at,
         completed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         result_envelope_json = excluded.result_envelope_json,
         status = excluded.status,
         diagnostics_json = excluded.diagnostics_json,
         artifact_refs_json = excluded.artifact_refs_json,
         completed_at = excluded.completed_at`
    ).run(
      record.id,
      record.taskEnvelope.id,
      record.taskEnvelope.taskType,
      record.taskEnvelope.host,
      record.taskEnvelope.outputContract.contractId,
      record.taskEnvelope.outputContract.schemaVersion,
      record.workerId ?? null,
      JSON.stringify(record.workerTrustProfile),
      JSON.stringify(record.taskEnvelope),
      record.resultEnvelope ? JSON.stringify(record.resultEnvelope) : null,
      record.status,
      JSON.stringify(record.diagnostics),
      JSON.stringify(record.artifactRefs),
      record.createdAt,
      record.completedAt ?? null
    );
    recordArtifactRefs(db, record, path);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }

  return {
    mode: "execute",
    path,
    record,
    written: true
  };
};

export const listWorkerTaskExecutionRecords = async (
  rootDir: string,
  limit = 50,
  cwStorageDir?: string
): Promise<WorkerTaskExecutionRecord[]> => {
  const storageDir = resolveStorageDir(rootDir, cwStorageDir);
  await bootstrapSqliteWorkspaceStore(storageDir);
  const db = await openSqliteWorkspaceStore(storageDir);

  try {
    return (db.prepare(
      `SELECT id, worker_id, worker_trust_json, task_envelope_json,
              result_envelope_json, status, diagnostics_json,
              artifact_refs_json, created_at, completed_at
       FROM worker_task_executions
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    ).all(limit) as Array<{
      artifact_refs_json: string;
      completed_at: string | null;
      created_at: string;
      diagnostics_json: string;
      id: string;
      result_envelope_json: string | null;
      status: WorkerTaskExecutionRecord["status"];
      task_envelope_json: string;
      worker_id: string | null;
      worker_trust_json: string;
    }>).map(hydrateRecord);
  } finally {
    db.close();
  }
};
