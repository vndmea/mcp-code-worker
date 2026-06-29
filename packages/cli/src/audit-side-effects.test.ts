import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildCli } from "@mcp-code-worker/cli";
import { getCwWorkspaceFilePath, listAuditEvents } from "@mcp-code-worker/core";
import { describe, expect, it } from "vitest";

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

const withWritableAuditWorkspace = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "cw-cli-audit-effects-"));

  try {
    process.chdir(rootDir);
    const configPath = getCwWorkspaceFilePath(rootDir, "config.json");
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          safety: {
            dryRun: false,
            allowWrite: true,
            allowedCommands: ["git", "node", "pnpm"]
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

describe("cli audit side effects", () => {
  it("writes an audit event for doctor", async () => {
    await withWritableAuditWorkspace(async (rootDir) => {
      const { io } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "cw", "doctor"]);
      const events = await listAuditEvents(rootDir, 20);

      expect(
        events.some(
          (event) => event.actor === "cli" && event.action === "doctor"
        )
      ).toBe(true);
    });
  });
});
