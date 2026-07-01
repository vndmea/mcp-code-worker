import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "../runtime/execution-context.js";
import type {
  WorkerResultEnvelope,
  WorkerTaskEnvelope
} from "../schemas/worker-task-envelope.schema.js";
import type { WorkerTrustProfile } from "../types/agent.js";
import {
  listWorkerTaskExecutionRecords,
  recordWorkerTaskExecution
} from "./worker-execution-store.js";
import { openSqliteWorkspaceStore } from "./sqlite.js";

const createTaskEnvelope = (): WorkerTaskEnvelope => ({
  id: "task-envelope-1",
  taskType: "review-lite",
  objective: "Review selected files",
  host: "codex",
  model: {
    provider: "mock",
    model: "worker-model"
  },
  constraints: ["Use selected context only."],
  context: {
    scope: "packages/core"
  },
  outputContract: {
    contractId: "review-worker",
    schemaVersion: "1.0.0"
  },
  trace: {
    createdAt: new Date().toISOString(),
    sourceWorkflow: "host-worker-workflow"
  }
});

const createTrustProfile = (): WorkerTrustProfile => ({
  workerId: "mock:worker-model",
  trustLevel: "benchmarked",
  onboardingStatus: "passed",
  interviewStatus: "passed",
  benchmarkStatus: "passed",
  recommendedMode: "dry-run",
  warnings: []
});

const createResultEnvelope = (): WorkerResultEnvelope => ({
  taskEnvelopeId: "task-envelope-1",
  taskType: "review-lite",
  status: "ok",
  output: {
    answer: "ok"
  },
  diagnostics: {
    modelBehaviorProfile: "mock-default",
    structuredOutputAttempts: 1,
    structuredOutputMode: "native-json-schema"
  }
});

describe("worker execution store", () => {
  it("keeps execution records dry-run until storage writes are allowed", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cw-worker-exec-dry-"));
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const result = await recordWorkerTaskExecution(context, {
      artifactRefs: ["worker-debug.json"],
      id: "worker-exec-dry-run",
      resultEnvelope: createResultEnvelope(),
      taskEnvelope: createTaskEnvelope(),
      workerId: "mock:worker-model",
      workerTrustProfile: createTrustProfile()
    });
    const records = await listWorkerTaskExecutionRecords(
      rootDir,
      10,
      context.cwStorageDir
    );

    expect(result.mode).toBe("dry-run");
    expect(result.written).toBe(false);
    expect(records).toEqual([]);
  });

  it("persists execution records and artifact references in sqlite", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "cw-worker-exec-write-"));
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = await recordWorkerTaskExecution(context, {
      artifactRefs: ["worker-debug.json"],
      diagnostics: {
        qualityGate: "ok"
      },
      id: "worker-exec-write",
      resultEnvelope: createResultEnvelope(),
      taskEnvelope: createTaskEnvelope(),
      workerId: "mock:worker-model",
      workerTrustProfile: createTrustProfile()
    });
    const records = await listWorkerTaskExecutionRecords(
      rootDir,
      10,
      context.cwStorageDir
    );
    const db = await openSqliteWorkspaceStore(context.cwStorageDir);

    try {
      const artifactRow = db
        .prepare("SELECT artifact_name FROM artifact_records WHERE execution_id = ?")
        .get("worker-exec-write") as { artifact_name: string } | undefined;

      expect(result.mode).toBe("execute");
      expect(result.written).toBe(true);
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe("worker-exec-write");
      expect(records[0]?.workerTrustProfile.trustLevel).toBe("benchmarked");
      expect(records[0]?.resultEnvelope?.diagnostics.structuredOutputMode).toBe(
        "native-json-schema"
      );
      expect(artifactRow?.artifact_name).toBe("worker-debug.json");
    } finally {
      db.close();
    }
  });
});
