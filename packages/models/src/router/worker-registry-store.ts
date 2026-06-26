import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AgentError,
  getAoWorkspaceFilePath,
  getAoWorkspaceFilePathFromStorageDir,
  WorkerRegistrationSchema,
  WorkerRegistrySchema,
  writeAuditEvent,
  type ExecutionContext,
  type ModelConfig,
  type WorkerRegistration
} from "@agent-orchestrator/core";

export interface WorkerRegistryReadResult {
  error?: string;
  exists: boolean;
  path: string;
  workers: WorkerRegistration[];
}

export const getWorkerRegistryPath = (
  rootDir: string,
  aoStorageDir?: string
): string =>
  aoStorageDir
    ? getAoWorkspaceFilePathFromStorageDir(aoStorageDir, "workers.json")
    : getAoWorkspaceFilePath(rootDir, "workers.json");

export const deriveWorkerRegistrationId = (config: ModelConfig): string =>
  `${config.provider}:${config.model}`;

export const readWorkerRegistry = async (
  rootDir: string,
  aoStorageDir?: string
): Promise<WorkerRegistryReadResult> => {
  const path = getWorkerRegistryPath(rootDir, aoStorageDir);

  try {
    const contents = await readFile(path, "utf8");
    const parsed = JSON.parse(contents) as unknown;
    const registry = WorkerRegistrySchema.safeParse(parsed);

    if (!registry.success) {
      return {
        exists: true,
        path,
        workers: [],
        error: registry.error.issues.map((issue) => issue.message).join("; ")
      };
    }

    return {
      exists: true,
      path,
      workers: registry.data.workers
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissing = /ENOENT/u.test(message);

    return {
      exists: !isMissing,
      path,
      workers: [],
      ...(isMissing ? {} : { error: message })
    };
  }
};

export const listWorkerRegistrations = async (
  rootDir: string,
  aoStorageDir?: string
): Promise<WorkerRegistration[]> => {
  const result = await readWorkerRegistry(rootDir, aoStorageDir);
  return result.workers;
};

export const getWorkerRegistration = async (
  rootDir: string,
  workerId: string,
  aoStorageDir?: string
): Promise<WorkerRegistration | null> => {
  const workers = await listWorkerRegistrations(rootDir, aoStorageDir);
  return workers.find((worker) => worker.workerId === workerId) ?? null;
};

const parseRegistration = (
  registration: WorkerRegistration
): WorkerRegistration => WorkerRegistrationSchema.parse(registration);

const assertReadableRegistry = (result: WorkerRegistryReadResult): void => {
  if (result.error) {
    throw new AgentError(
      "WORKER_REGISTRY_INVALID",
      `Worker registry could not be parsed: ${result.error}`,
      { path: result.path }
    );
  }
};

export const saveWorkerRegistration = async (
  context: ExecutionContext,
  registration: WorkerRegistration,
  explicitAllowWrite = false
): Promise<{ mode: "execute" | "dry-run"; path: string }> => {
  const parsed = parseRegistration(registration);
  const path = getWorkerRegistryPath(context.rootDir, context.aoStorageDir);
  const evaluation = context.writePolicy.evaluate(path, explicitAllowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "save-worker-registration",
      mode: "blocked",
      tool: "worker-registry",
      inputSummary: parsed.workerId,
      outputSummary: evaluation.reason,
      warnings: [],
      errors: [evaluation.reason],
      metadata: {
        workerId: parsed.workerId
      }
    });
    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      path: evaluation.normalizedPath
    });
  }

  if (evaluation.mode === "dry-run") {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "save-worker-registration",
      mode: "dry-run",
      tool: "worker-registry",
      inputSummary: parsed.workerId,
      outputSummary: "Worker registration would be saved.",
      warnings: [],
      errors: [],
      metadata: {
        workerId: parsed.workerId
      }
    });

    return {
      mode: "dry-run",
      path: evaluation.normalizedPath
    };
  }

  const existing = await readWorkerRegistry(
    context.rootDir,
    context.aoStorageDir
  );
  assertReadableRegistry(existing);

  const merged = new Map(existing.workers.map((worker) => [worker.workerId, worker]));
  merged.set(parsed.workerId, parsed);

  await mkdir(dirname(evaluation.normalizedPath), { recursive: true });
  await writeFile(
    evaluation.normalizedPath,
    JSON.stringify(
      {
        version: 1,
        workers: Array.from(merged.values())
      },
      null,
      2
    ),
    "utf8"
  );
  await writeAuditEvent(context, {
    actor: "tool",
    action: "save-worker-registration",
    mode: "execute",
    tool: "worker-registry",
    inputSummary: parsed.workerId,
    outputSummary: "Worker registration saved.",
    warnings: [],
    errors: [],
    metadata: {
      workerId: parsed.workerId
    }
  }, explicitAllowWrite);

  return {
    mode: "execute",
    path: evaluation.normalizedPath
  };
};

export const removeWorkerRegistration = async (
  context: ExecutionContext,
  workerId: string,
  explicitAllowWrite = false
): Promise<{ mode: "execute" | "dry-run"; path: string; removed: boolean }> => {
  const path = getWorkerRegistryPath(context.rootDir, context.aoStorageDir);
  const evaluation = context.writePolicy.evaluate(path, explicitAllowWrite);

  if (!evaluation.allowed || evaluation.mode === "blocked") {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "remove-worker-registration",
      mode: "blocked",
      tool: "worker-registry",
      inputSummary: workerId,
      outputSummary: evaluation.reason,
      warnings: [],
      errors: [evaluation.reason],
      metadata: {
        workerId
      }
    });
    throw new AgentError("WRITE_BLOCKED", evaluation.reason, {
      path: evaluation.normalizedPath
    });
  }

  if (evaluation.mode === "dry-run") {
    await writeAuditEvent(context, {
      actor: "tool",
      action: "remove-worker-registration",
      mode: "dry-run",
      tool: "worker-registry",
      inputSummary: workerId,
      outputSummary: "Worker registration would be removed.",
      warnings: [],
      errors: [],
      metadata: {
        workerId
      }
    });

    return {
      mode: "dry-run",
      path: evaluation.normalizedPath,
      removed: false
    };
  }

  const existing = await readWorkerRegistry(
    context.rootDir,
    context.aoStorageDir
  );
  assertReadableRegistry(existing);

  const nextWorkers = existing.workers.filter(
    (worker) => worker.workerId !== workerId
  );
  const removed = nextWorkers.length !== existing.workers.length;

  await mkdir(dirname(evaluation.normalizedPath), { recursive: true });
  await writeFile(
    evaluation.normalizedPath,
    JSON.stringify(
      {
        version: 1,
        workers: nextWorkers
      },
      null,
      2
    ),
    "utf8"
  );
  await writeAuditEvent(context, {
    actor: "tool",
    action: "remove-worker-registration",
    mode: "execute",
    tool: "worker-registry",
    inputSummary: workerId,
    outputSummary: removed
      ? "Worker registration removed."
      : "Worker registration was not present.",
    warnings: [],
    errors: [],
    metadata: {
      workerId,
      removed
    }
  }, explicitAllowWrite);

  return {
    mode: "execute",
    path: evaluation.normalizedPath,
    removed
  };
};
