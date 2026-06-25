import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const distCliPath = join(process.cwd(), "packages", "cli", "dist", "main.js");

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-smoke-dist-"));
  await callback(rootDir);
};

describe("cli dist smoke", () => {
  it("runs the built cli entrypoint without network access", async () => {
    await withTempCwd(async (rootDir) => {
      const help = await execFile("node", [distCliPath, "--help"], {
        cwd: rootDir
      });
      expect(help.stdout).toContain("Agent Orchestrator CLI");

      const doctor = await execFile("node", [distCliPath, "doctor"], {
        cwd: rootDir
      });
      expect(JSON.parse(doctor.stdout) as { checks: unknown[] }).toHaveProperty("checks");

      const tools = await execFile("node", [distCliPath, "mcp", "list-tools"], {
        cwd: rootDir
      });
      expect(
        (JSON.parse(tools.stdout) as Array<{ name: string }>).some(
          (tool) => tool.name === "ao_start_task"
        )
      ).toBe(true);

      const config = await execFile("node", [distCliPath, "mcp", "config"], {
        cwd: rootDir
      });
      expect(
        (JSON.parse(config.stdout) as { mcpServers: Record<string, unknown> }).mcpServers[
          "agent-orchestrator"
        ]
      ).toBeTruthy();
    });
  });
});
