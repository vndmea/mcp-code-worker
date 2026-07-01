import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";
import { getCwWorkspaceId } from "@mcp-code-worker/core";

const execFile = promisify(execFileCallback);
const repoRoot = process.cwd();
const cliPackageDir = join(repoRoot, "packages", "cli");
const publishDir = join(cliPackageDir, ".publish");
const builtCliEntry = join(cliPackageDir, "dist", "main.js");
const cwStorageRoot = (homeDir: string): string => join(homeDir, ".code-worker");
const installedCwPath = (prefixDir: string): string =>
  join(prefixDir, "node_modules", ".bin", process.platform === "win32" ? "cw.cmd" : "cw");

const tempPaths: string[] = [];

const trackTempDir = async (prefix: string): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempPaths.push(path);
  return path;
};

const listToolNames = (stdout: string): string[] => {
  const parsed = JSON.parse(stdout) as
    | Array<{ name: string }>
    | {
        groups?: Array<{
          tools: Array<{ name: string }>;
        }>;
      };

  return Array.isArray(parsed)
    ? parsed.map((tool) => tool.name)
    : (parsed.groups ?? []).flatMap((group) => group.tools.map((tool) => tool.name));
};

const stripAnsi = (value: string): string =>
  value.replaceAll(/\u001b\[[0-9;]*m/g, "");

const parsePackEntries = (stdout: string): Array<{ filename: string }> => {
  const normalized = stripAnsi(stdout).trim();
  const match = normalized.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);

  if (!match) {
    throw new Error(`Unable to parse npm pack output: ${normalized}`);
  }

  return JSON.parse(match[1] ?? "[]") as Array<{ filename: string }>;
};

const runCommand = async (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string }> =>
  process.platform === "win32"
    ? execFile("cmd.exe", ["/d", "/s", "/c", command, ...args], { cwd, env })
    : execFile(command, args, { cwd, env });

const removeTrackedPath = async (path: string): Promise<void> => {
  await rm(path, {
    force: true,
    recursive: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 200
  });
};

const preparePackedCli = async (): Promise<void> => {
  try {
    await access(builtCliEntry);
    await runCommand("pnpm", ["run", "prepare:publish"], cliPackageDir);
  } catch {
    await runCommand("pnpm", ["run", "prepack"], cliPackageDir);
  }
};

describe("cli packed tarball smoke", () => {
  afterEach(async () => {
    for (const path of tempPaths.splice(0, tempPaths.length)) {
      await removeTrackedPath(path);
    }
  });

  it("installs from npm pack output and runs the cw bin shim", async () => {
    const installPrefix = await trackTempDir("cw-pack-prefix-");
    const homeDir = await trackTempDir("cw-pack-home-");
    const workspaceRoot = await trackTempDir("cw-pack-workspace-");
    const cwHomeDir = cwStorageRoot(homeDir);

    await preparePackedCli();

    const pack = await runCommand("npm", ["pack", "--json"], publishDir);
    const packEntries = parsePackEntries(pack.stdout);
    const filename = packEntries[0]?.filename;
    expect(filename).toBeTruthy();
    if (!filename) {
      throw new Error("npm pack did not return a tarball filename");
    }
    const tarballPath = join(publishDir, filename);

    try {
      await runCommand(
        "npm",
        ["install", "--prefix", installPrefix, "--no-audit", "--no-fund", tarballPath],
        repoRoot
      );

      const cwPath = installedCwPath(installPrefix);
      const commandEnv = {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        HOMEDRIVE: undefined,
        HOMEPATH: undefined
      };

      const help = await runCommand(cwPath, ["--help"], workspaceRoot, commandEnv);
      expect(help.stdout).toContain("MCP Code Worker CLI");

      const doctor = await runCommand(cwPath, ["doctor"], workspaceRoot, commandEnv);
      expect(JSON.parse(doctor.stdout) as { checks: unknown[] }).toHaveProperty("checks");

      const probe = await runCommand(
        cwPath,
        ["doctor", "--probe"],
        workspaceRoot,
        commandEnv
      );
      expect(probe.stdout).toContain("\"worker-connectivity\"");

      const init = await runCommand(
        cwPath,
        ["init", "--allow-write"],
        workspaceRoot,
        commandEnv
      );
      expect(init.stdout).toContain("\"mode\": \"execute\"");

      const config = await runCommand(
        cwPath,
        ["mcp", "config"],
        workspaceRoot,
        commandEnv
      );
      const parsedConfig = JSON.parse(config.stdout) as {
        mcpServers?: Record<
          string,
          {
            args?: string[];
          }
        >;
      };
      expect(parsedConfig.mcpServers?.["mcp-code-worker"]?.args).toEqual(["mcp", "serve"]);

      const tools = await runCommand(
        cwPath,
        ["mcp", "list-tools"],
        workspaceRoot,
        commandEnv
      );
      expect(listToolNames(tools.stdout)).toContain("cw_start_task");

      const workspaceStorageDir = join(cwHomeDir, getCwWorkspaceId(workspaceRoot));
      await access(join(workspaceStorageDir, "data.db"));

      const storedConfig = JSON.parse(
        await readFile(join(workspaceStorageDir, "config.json"), "utf8")
      ) as {
        version?: number;
      };
      expect(storedConfig.version).toBe(2);
    } finally {
      await rm(tarballPath, { force: true });
    }
  }, 180_000);
});
