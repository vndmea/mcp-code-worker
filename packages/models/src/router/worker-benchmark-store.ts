import { resolve } from "node:path";

import {
  bootstrapSqliteWorkspaceStore,
  openSqliteWorkspaceStore,
  WorkerBenchmarkResultSchema,
  qualifiesPatchGenerationCapability,
  type ExecutionContext,
  type WorkerBenchmarkResult
} from "@mcp-code-worker/core";

export interface WorkerBenchmarkRecord {
  benchmark: WorkerBenchmarkResult;
  createdAt: string;
  id: number;
  patchGenerationQualified: boolean;
  suiteName: string;
  updatedAt: string;
  workerId: string;
}

export const getWorkerBenchmarkStorePath = (
  rootDir: string,
  cwStorageDir?: string
): string =>
  resolve(cwStorageDir ?? rootDir, "data.db#worker_benchmarks");

const mapBenchmarkRecord = (row: {
  benchmark_json: string;
  created_at: string;
  id: number;
  patch_generation_qualified: number;
  suite_name: string;
  updated_at: string;
  worker_id: string;
}): WorkerBenchmarkRecord => ({
  id: row.id,
  workerId: row.worker_id,
  suiteName: row.suite_name,
  benchmark: WorkerBenchmarkResultSchema.parse(JSON.parse(row.benchmark_json)),
  patchGenerationQualified: row.patch_generation_qualified === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const listWorkerBenchmarks = async (
  rootDir: string,
  workerId: string,
  cwStorageDir?: string
): Promise<WorkerBenchmarkRecord[]> => {
  if (!cwStorageDir) {
    void rootDir;
    return [];
  }

  await bootstrapSqliteWorkspaceStore(cwStorageDir);
  const db = await openSqliteWorkspaceStore(cwStorageDir);
  try {
    const rows = db.prepare(
      `SELECT id, worker_id, suite_name, benchmark_json, patch_generation_qualified, created_at, updated_at
       FROM worker_benchmarks
       WHERE worker_id = ?
       ORDER BY updated_at DESC, id DESC`
    ).all(workerId) as Array<{
      benchmark_json: string;
      created_at: string;
      id: number;
      patch_generation_qualified: number;
      suite_name: string;
      updated_at: string;
      worker_id: string;
    }>;

    return rows.map(mapBenchmarkRecord);
  } finally {
    db.close();
  }
};

export const getLatestWorkerBenchmark = async (input: {
  cwStorageDir?: string;
  rootDir: string;
  suiteName: string;
  workerId: string;
}): Promise<WorkerBenchmarkRecord | null> => {
  if (!input.cwStorageDir) {
    return null;
  }

  await bootstrapSqliteWorkspaceStore(input.cwStorageDir);
  const db = await openSqliteWorkspaceStore(input.cwStorageDir);
  try {
    const row = db.prepare(
      `SELECT id, worker_id, suite_name, benchmark_json, patch_generation_qualified, created_at, updated_at
       FROM worker_benchmarks
       WHERE worker_id = ? AND suite_name = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(input.workerId, input.suiteName) as
      | {
          benchmark_json: string;
          created_at: string;
          id: number;
          patch_generation_qualified: number;
          suite_name: string;
          updated_at: string;
          worker_id: string;
        }
      | undefined;

    return row ? mapBenchmarkRecord(row) : null;
  } finally {
    db.close();
  }
};

export const saveWorkerBenchmark = async (
  context: ExecutionContext,
  benchmark: WorkerBenchmarkResult,
  explicitAllowWrite = false
): Promise<{ mode: "execute" | "dry-run"; path: string }> => {
  const path = getWorkerBenchmarkStorePath(
    context.rootDir,
    context.cwStorageDir
  );
  const evaluation = context.storageWritePolicy.evaluate(
    "benchmark-write",
    explicitAllowWrite
  );

  if (evaluation.mode !== "execute") {
    return {
      mode: "dry-run",
      path
    };
  }

  await bootstrapSqliteWorkspaceStore(context.cwStorageDir);
  const db = await openSqliteWorkspaceStore(context.cwStorageDir);
  try {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO worker_benchmarks(
         worker_id,
         suite_name,
         benchmark_json,
         patch_generation_qualified,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      benchmark.workerId,
      benchmark.suiteName,
      JSON.stringify(benchmark),
      qualifiesPatchGenerationCapability(benchmark) ? 1 : 0,
      now,
      now
    );
  } finally {
    db.close();
  }

  return {
    mode: "execute",
    path
  };
};
