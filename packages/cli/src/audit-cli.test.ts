import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCli } from "@mcp-code-worker/cli";
import {
  bootstrapSqliteWorkspaceStore,
  getCwWorkspaceDir,
  openSqliteWorkspaceStore
} from "@mcp-code-worker/core";

const createIo = () => {
  const output: string[] = [];
  const errors: string[] = [];

  return {
    output,
    errors,
    io: {
      write: (message: string) => {
        output.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      }
    }
  };
};

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "cw-cli-audit-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

describe("audit cli", () => {
  it("returns an empty array when no audit logs exist", async () => {
    await withTempCwd(async () => {
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "audit", "list"]);

      expect(output.join("\n")).toContain("[]");
    });
  });

  it("lists audit events and respects limit", async () => {
    await withTempCwd(async (rootDir) => {
      const cwStorageDir = getCwWorkspaceDir(rootDir);
      await bootstrapSqliteWorkspaceStore(cwStorageDir);
      const db = await openSqliteWorkspaceStore(cwStorageDir);

      try {
        db.prepare(
          `INSERT INTO audit_events(
             id,
             event_type,
             actor,
             action,
             mode,
             workflow,
             tool,
             input_summary,
             output_summary,
             warnings_json,
             errors_json,
             metadata_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "1",
          "cli:older",
          "cli",
          "older",
          "execute",
          null,
          null,
          "older",
          null,
          "[]",
          "[]",
          null,
          "2026-06-25T10:00:00.000Z"
        );
        db.prepare(
          `INSERT INTO audit_events(
             id,
             event_type,
             actor,
             action,
             mode,
             workflow,
             tool,
             input_summary,
             output_summary,
             warnings_json,
             errors_json,
             metadata_json,
             created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "2",
          "cli:newer",
          "cli",
          "newer",
          "execute",
          null,
          null,
          "newer",
          null,
          "[]",
          "[]",
          null,
          "2026-06-25T11:00:00.000Z"
        );
      } finally {
        db.close();
      }
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "audit", "list", "--limit", "1"]);

      expect(output.join("\n")).toContain("\"id\": \"2\"");
      expect(output.join("\n")).not.toContain("\"id\": \"1\"");
    });
  });
});
