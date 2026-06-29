import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  getCwWorkspaceFilePath,
  getCwWorkspaceFilePathFromStorageDir,
  WorkerCapabilityProfileSchema
} from "@mcp-code-worker/core";
import type {
  ExecutionContext,
  WorkerCapabilityProfile
} from "@mcp-code-worker/core";

const inMemoryProfiles = new Map<string, WorkerCapabilityProfile>();
export interface PersistedWorkerProfilesReadResult {
  error?: string;
  exists: boolean;
  path: string;
  profiles: WorkerCapabilityProfile[];
}

export const getWorkerProfileStorePath = (
  rootDir: string,
  cwStorageDir?: string
): string =>
  cwStorageDir
    ? getCwWorkspaceFilePathFromStorageDir(cwStorageDir, "worker-profiles.json")
    : getCwWorkspaceFilePath(rootDir, "worker-profiles.json");

const safeParseProfiles = (value: string): WorkerCapabilityProfile[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    const schemaResult = WorkerCapabilityProfileSchema.array().safeParse(parsed);
    return schemaResult.success ? schemaResult.data : [];
  } catch {
    return [];
  }
};

export const listPersistedWorkerProfiles = async (
  rootDir: string,
  cwStorageDir?: string
): Promise<WorkerCapabilityProfile[]> => {
  const result = await readPersistedWorkerProfiles(rootDir, cwStorageDir);
  return result.profiles;
};

export const readPersistedWorkerProfiles = async (
  rootDir: string,
  cwStorageDir?: string
): Promise<PersistedWorkerProfilesReadResult> => {
  const path = getWorkerProfileStorePath(rootDir, cwStorageDir);

  try {
    const contents = await readFile(path, "utf8");
    const parsed = safeParseProfiles(contents);
    const raw = JSON.parse(contents) as unknown;
    const schemaResult = WorkerCapabilityProfileSchema.array().safeParse(raw);

    return {
      exists: true,
      path,
      profiles: parsed,
      ...(schemaResult.success
        ? {}
        : {
            error: schemaResult.error.issues
              .map((issue) => issue.message)
              .join("; ")
          })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissing = /ENOENT/u.test(message);

    return {
      exists: !isMissing,
      path,
      profiles: [],
      ...(isMissing ? {} : { error: message })
    };
  }
};

export const listWorkerProfiles = async (
  rootDir: string,
  cwStorageDir?: string
): Promise<WorkerCapabilityProfile[]> => {
  const persisted = await listPersistedWorkerProfiles(rootDir, cwStorageDir);
  const merged = new Map<string, WorkerCapabilityProfile>();

  persisted.forEach((profile) => {
    merged.set(profile.workerId, profile);
  });
  inMemoryProfiles.forEach((profile, workerId) => {
    merged.set(workerId, profile);
  });

  return Array.from(merged.values());
};

export const getWorkerProfile = async (
  rootDir: string,
  workerId: string,
  cwStorageDir?: string
): Promise<WorkerCapabilityProfile | null> => {
  const inMemory = inMemoryProfiles.get(workerId);
  if (inMemory) {
    return inMemory;
  }

  const persisted = await listPersistedWorkerProfiles(rootDir, cwStorageDir);
  return persisted.find((profile) => profile.workerId === workerId) ?? null;
};

export const saveWorkerProfile = async (
  context: ExecutionContext,
  profile: WorkerCapabilityProfile,
  explicitAllowWrite = false
): Promise<{ mode: "execute" | "dry-run"; path: string }> => {
  inMemoryProfiles.set(profile.workerId, profile);

  const storePath = getWorkerProfileStorePath(
    context.rootDir,
    context.cwStorageDir
  );
  const evaluation = context.writePolicy.evaluate(storePath, explicitAllowWrite);

  if (evaluation.mode === "dry-run") {
    return {
      mode: "dry-run",
      path: storePath
    };
  }

  const existing = await listPersistedWorkerProfiles(
    context.rootDir,
    context.cwStorageDir
  );
  const merged = new Map(existing.map((item) => [item.workerId, item]));
  merged.set(profile.workerId, profile);

  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(Array.from(merged.values()), null, 2),
    "utf8"
  );

  return {
    mode: "execute",
    path: storePath
  };
};

export const clearInMemoryWorkerProfiles = (): void => {
  inMemoryProfiles.clear();
};
