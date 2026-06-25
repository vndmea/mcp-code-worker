import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExecutionContext } from "../runtime/execution-context.js";

export type AuditActor =
  | "leader"
  | "worker"
  | "tool"
  | "cli"
  | "mcp"
  | "workflow";

export type AuditMode = "execute" | "dry-run" | "blocked";

export interface AuditEvent {
  id: string;
  timestamp: string;
  workflow?: string;
  tool?: string;
  actor: AuditActor;
  action: string;
  mode: AuditMode;
  inputSummary: string;
  outputSummary?: string;
  warnings: string[];
  errors: string[];
  metadata?: Record<string, unknown>;
}

export interface WriteAuditEventResult {
  mode: "execute" | "dry-run";
  path: string;
  written: boolean;
}

const REDACTED_VALUE = "[REDACTED]";
const SECRET_KEY_PATTERN =
  /(key|token|secret|password|authorization|cookie)/iu;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  if (!isRecord(value)) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => {
      if (SECRET_KEY_PATTERN.test(key)) {
        return [key, REDACTED_VALUE];
      }

      return [key, sanitizeValue(childValue, seen)];
    })
  );
};

const getAuditDirectory = (rootDir: string): string =>
  join(rootDir, ".ao", "audit");

const getAuditPath = (rootDir: string, timestamp: Date): string =>
  join(getAuditDirectory(rootDir), `${timestamp.toISOString().slice(0, 10)}.jsonl`);

const isAuditEvent = (value: unknown): value is AuditEvent =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.timestamp === "string" &&
  typeof value.actor === "string" &&
  typeof value.action === "string" &&
  typeof value.mode === "string" &&
  typeof value.inputSummary === "string" &&
  Array.isArray(value.warnings) &&
  Array.isArray(value.errors);

export const sanitizeAuditMetadata = (
  metadata: Record<string, unknown>
): Record<string, unknown> => {
  try {
    return sanitizeValue(metadata, new WeakSet<object>()) as Record<
      string,
      unknown
    >;
  } catch {
    return {
      metadata: "[Unserializable metadata]"
    };
  }
};

export async function writeAuditEvent(
  context: ExecutionContext,
  event: Omit<AuditEvent, "id" | "timestamp">,
  explicitAllowWrite = false
): Promise<WriteAuditEventResult> {
  const now = new Date();
  const path = getAuditPath(context.rootDir, now);
  const evaluation = context.writePolicy.evaluate(path, explicitAllowWrite);

  if (evaluation.mode !== "execute") {
    return {
      mode: "dry-run",
      path: evaluation.normalizedPath,
      written: false
    };
  }

  const payload: AuditEvent = {
    ...event,
    id: randomUUID(),
    timestamp: now.toISOString(),
    metadata: event.metadata
      ? sanitizeAuditMetadata(event.metadata)
      : undefined
  };

  try {
    await mkdir(getAuditDirectory(context.rootDir), { recursive: true });
    await appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");

    return {
      mode: "execute",
      path: evaluation.normalizedPath,
      written: true
    };
  } catch {
    return {
      mode: "execute",
      path: evaluation.normalizedPath,
      written: false
    };
  }
}

export const listAuditEvents = async (
  rootDir: string,
  limit = 50
): Promise<AuditEvent[]> => {
  const auditDirectory = getAuditDirectory(rootDir);

  try {
    const files = (await readdir(auditDirectory))
      .filter((fileName) => fileName.endsWith(".jsonl"))
      .sort((left, right) => right.localeCompare(left));
    const events: AuditEvent[] = [];

    for (const fileName of files) {
      const contents = await readFile(join(auditDirectory, fileName), "utf8");
      const lines = contents
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .reverse();

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isAuditEvent(parsed)) {
            events.push(parsed);
          }
        } catch {
          // Ignore invalid JSONL lines during listing.
        }

        if (events.length >= limit) {
          return events.slice(0, limit);
        }
      }
    }

    return events.slice(0, limit);
  } catch {
    return [];
  }
};
