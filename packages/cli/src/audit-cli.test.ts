import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCli } from "@agent-orchestrator/cli";

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
  const rootDir = await mkdtemp(join(tmpdir(), "ao-cli-audit-"));

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

      await cli.parseAsync(["node", "ao", "audit", "list"]);

      expect(output.join("\n")).toContain("[]");
    });
  });

  it("lists audit events and respects limit", async () => {
    await withTempCwd(async (rootDir) => {
      const auditDir = join(rootDir, ".ao", "audit");
      await mkdir(auditDir, { recursive: true });
      await writeFile(
        join(auditDir, "2026-06-25.jsonl"),
        [
          JSON.stringify({
            id: "1",
            timestamp: "2026-06-25T10:00:00.000Z",
            actor: "cli",
            action: "older",
            mode: "execute",
            inputSummary: "older",
            warnings: [],
            errors: []
          }),
          JSON.stringify({
            id: "2",
            timestamp: "2026-06-25T11:00:00.000Z",
            actor: "cli",
            action: "newer",
            mode: "execute",
            inputSummary: "newer",
            warnings: [],
            errors: []
          })
        ].join("\n"),
        "utf8"
      );
      const { io, output } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "ao", "audit", "list", "--limit", "1"]);

      expect(output.join("\n")).toContain("\"id\": \"2\"");
      expect(output.join("\n")).not.toContain("\"id\": \"1\"");
    });
  });
});
