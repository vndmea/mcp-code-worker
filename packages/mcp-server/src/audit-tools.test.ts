import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  aoListAuditEventsTool,
  aoToolDefinitions
} from "@agent-orchestrator/mcp-server";

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "ao-mcp-audit-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

describe("mcp audit tools", () => {
  it("registers ao_list_audit_events", () => {
    expect(aoToolDefinitions.map((tool) => tool.name)).toContain(
      "ao_list_audit_events"
    );
  });

  it("returns an empty array when no audit logs exist", async () => {
    await withTempCwd(async () => {
      const events = await aoListAuditEventsTool.execute({});

      expect(events).toEqual([]);
    });
  });
});
