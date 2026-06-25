import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  listAuditEvents,
  sanitizeAuditMetadata,
  writeAuditEvent
} from "@agent-orchestrator/core";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-audit-"));

describe("audit log", () => {
  it("redacts secret-like metadata recursively", () => {
    const metadata = sanitizeAuditMetadata({
      apiKey: "secret",
      nested: {
        authToken: "token",
        items: [
          {
            cookieValue: "cookie"
          }
        ]
      }
    });

    expect(metadata).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        authToken: "[REDACTED]",
        items: [
          {
            cookieValue: "[REDACTED]"
          }
        ]
      }
    });
  });

  it("writes JSONL audit events when writes are allowed", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });

    const result = await writeAuditEvent(context, {
      actor: "tool",
      action: "test-event",
      mode: "execute",
      inputSummary: "input",
      outputSummary: "output",
      warnings: [],
      errors: [],
      metadata: {
        apiKey: "secret"
      }
    });
    const events = await listAuditEvents(rootDir, 10);

    expect(result.written).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({
      apiKey: "[REDACTED]"
    });
  });

  it("returns dry-run and does not write audit files by default", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      allowWrite: false,
      dryRun: true,
      rootDir
    });

    const result = await writeAuditEvent(context, {
      actor: "tool",
      action: "dry-run-event",
      mode: "dry-run",
      inputSummary: "input",
      warnings: [],
      errors: []
    });
    const events = await listAuditEvents(rootDir, 10);

    expect(result.written).toBe(false);
    expect(events).toEqual([]);
  });

  it("lists latest audit events first and skips invalid JSONL lines", async () => {
    const rootDir = await createRootDir();
    const auditDir = join(rootDir, ".ao", "audit");
    await mkdir(auditDir, { recursive: true });
    await writeFile(
      join(auditDir, "2026-06-24.jsonl"),
      [
        JSON.stringify({
          id: "older",
          timestamp: "2026-06-24T10:00:00.000Z",
          actor: "tool",
          action: "older",
          mode: "execute",
          inputSummary: "older",
          warnings: [],
          errors: []
        }),
        "not-json"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(auditDir, "2026-06-25.jsonl"),
      JSON.stringify({
        id: "newer",
        timestamp: "2026-06-25T10:00:00.000Z",
        actor: "tool",
        action: "newer",
        mode: "execute",
        inputSummary: "newer",
        warnings: [],
        errors: []
      }),
      "utf8"
    );

    const events = await listAuditEvents(rootDir, 2);

    expect(events.map((event) => event.id)).toEqual(["newer", "older"]);
  });
});
