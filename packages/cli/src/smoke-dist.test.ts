import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { getCwWorkspaceId } from "@mcp-code-worker/core";

const execFile = promisify(execFileCallback);
const repoRoot = process.cwd();
const distCliPath = join(repoRoot, "packages", "cli", "dist", "main.js");
const sourceCliPath = join(repoRoot, "packages", "cli", "src", "main.ts");
const tsxPath = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx"
);

const withTempCwd = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const rootDir = await mkdtemp(join(tmpdir(), "cw-smoke-dist-"));
  await callback(rootDir);
};

const withTempHome = async (
  callback: (homeDir: string) => Promise<void>
): Promise<void> => {
  const homeDir = await mkdtemp(join(tmpdir(), "cw-smoke-home-"));
  await callback(homeDir);
};

const runCommand = async (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stderr: string; stdout: string }> =>
  process.platform === "win32"
    ? execFile("cmd.exe", ["/d", "/s", "/c", command, ...args], { cwd, env })
    : execFile(command, args, { cwd, env });

const runSourceCli = async (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stderr: string; stdout: string }> =>
  runCommand(tsxPath, [sourceCliPath, ...args], cwd, env);

const runDistCli = async (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stderr: string; stdout: string }> =>
  execFile(process.execPath, [distCliPath, ...args], { cwd, env });

const runPnpmExecCli = async (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<{ stderr: string; stdout: string }> =>
  runCommand("pnpm", ["exec", "cw", ...args], cwd, env);

const createCommandEnv = (homeDir: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  HOMEDRIVE: undefined,
  HOMEPATH: undefined
});

const getWorkspaceStorageDir = (rootDir: string, homeDir: string): string =>
  join(homeDir, ".cw", "workspaces", getCwWorkspaceId(rootDir));

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

const writeCwConfig = async (
  rootDir: string,
  homeDir: string,
  config: Record<string, unknown>
): Promise<void> => {
  const configDir = getWorkspaceStorageDir(rootDir, homeDir);
  const configPath = join(configDir, "config.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        ...config
      },
      null,
      2
    ),
    "utf8"
  );
};

const writeRegistry = async (
  rootDir: string,
  homeDir: string,
  workers: unknown[]
): Promise<void> => {
  const configDir = getWorkspaceStorageDir(rootDir, homeDir);
  const registryPath = join(configDir, "workers.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    registryPath,
    JSON.stringify({ version: 1, workers }, null, 2),
    "utf8"
  );
};

const createRegistration = (overrides: Record<string, unknown> = {}) => {
  const now = new Date().toISOString();

  return {
    workerId: "mock:registered-worker",
    provider: "mock",
    model: "gpt-5.4-mini",
    enabled: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
};

const normalizeDoctorReport = (stdout: string) => {
  const report = JSON.parse(stdout) as {
    checks?: Array<{
      details?: string;
      name: string;
      status: string;
      summary?: string;
    }>;
    nextCommand?: { command?: string; reason?: string };
    summary?: string;
  };
  const findCheck = (name: string) =>
    report.checks?.find((check) => check.name === name) ?? null;

  return {
    summary: report.summary,
    nextCommand: report.nextCommand,
    localClientCommand: findCheck("local-client-command"),
    localClientCompatibility: findCheck("local-client-compatibility")
  };
};

const normalizeWorkerInterview = (stdout: string) => {
  const result = JSON.parse(stdout) as {
    profile?: {
      admission?: { passed?: boolean };
      routingPolicy?: {
        allowCodegen?: boolean;
        allowPatchGeneration?: boolean;
      };
      status?: string;
      supportedTaskTypes?: string[];
      workerId?: string;
    };
    warnings?: string[];
  };

  return {
    profile: {
      admissionPassed: result.profile?.admission?.passed,
      allowCodegen: result.profile?.routingPolicy?.allowCodegen,
      allowPatchGeneration: result.profile?.routingPolicy?.allowPatchGeneration,
      status: result.profile?.status,
      supportedTaskTypes: result.profile?.supportedTaskTypes,
      workerId: result.profile?.workerId
    },
    warnings: result.warnings ?? []
  };
};

const writeCodexConfig = async (
  homeDir: string,
  config: {
    args: string[];
    command: string;
    env?: Record<string, string>;
  }
): Promise<void> => {
  const codexDir = join(homeDir, ".codex");
  const codexConfigPath = join(codexDir, "config.toml");
  const envEntries = Object.entries(config.env ?? {});
  const envBlock =
    envEntries.length > 0
      ? [
          "",
          `[mcp_servers."mcp-code-worker".env]`,
          ...envEntries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
        ].join("\n")
      : "";
  const contents = [
    `[mcp_servers."mcp-code-worker"]`,
    `command = ${JSON.stringify(config.command)}`,
    `args = ${JSON.stringify(config.args)}`,
    envBlock
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  await mkdir(codexDir, { recursive: true });
  await writeFile(codexConfigPath, contents, "utf8");
};

describe("cli dist smoke", () => {
  it("runs the built cli entrypoint without network access", async () => {
    await withTempCwd(async (rootDir) => {
      const help = await execFile("node", [distCliPath, "--help"], {
        cwd: rootDir
      });
      expect(help.stdout).toContain("MCP Code Worker CLI");

      const doctor = await execFile("node", [distCliPath, "doctor"], {
        cwd: rootDir
      });
      expect(JSON.parse(doctor.stdout) as { checks: unknown[] }).toHaveProperty("checks");

      const tools = await execFile("node", [distCliPath, "mcp", "list-tools"], {
        cwd: rootDir
      });
      const toolNames = listToolNames(tools.stdout);
      expect(toolNames).toContain("cw_start_task");

      const config = await execFile("node", [distCliPath, "mcp", "config"], {
        cwd: rootDir
      });
      expect(
        (JSON.parse(config.stdout) as { mcpServers: Record<string, unknown> }).mcpServers[
          "mcp-code-worker"
        ]
      ).toBeTruthy();

      const codexConfig = await execFile(
        "node",
        [distCliPath, "mcp", "config", "--host=codex"],
        {
          cwd: rootDir
        }
      );
      expect(codexConfig.stdout).toContain('[mcp_servers."mcp-code-worker"]');
      expect(codexConfig.stdout).toContain('args = ["mcp", "serve"]');
    });
  }, 15_000);

  it("keeps repo-root pnpm exec cw aligned with the built worker command surface", async () => {
    const [pnpmExecHelp, distHelp] = await Promise.all([
      runPnpmExecCli(["worker", "--help"], repoRoot),
      runDistCli(["worker", "--help"], repoRoot)
    ]);

    expect(pnpmExecHelp.stdout).toContain("readiness [options]");
    expect(pnpmExecHelp.stdout).toBe(distHelp.stdout);
  }, 20_000);

  it("tests live MCP launch and tool discovery through doctor --mcp", async () => {
    await withTempCwd(async (rootDir) => {
      await withTempHome(async (homeDir) => {
        await writeCodexConfig(homeDir, {
          command: process.execPath,
          args: [distCliPath, "mcp", "serve"]
        });

        const env = {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          HOMEDRIVE: undefined,
          HOMEPATH: undefined
        };
        const doctor = await execFile(
          "node",
          [distCliPath, "doctor", "--mcp", "--host", "codex"],
          {
            cwd: rootDir,
            env
          }
        );
        const result = JSON.parse(doctor.stdout) as {
          checks?: Array<{ name: string; status: string }>;
        };

        expect(
          result.checks?.some(
            (check) =>
              check.name === "mcp-server-launchable" && check.status === "pass"
          )
        ).toBe(true);
        expect(
          result.checks?.some(
            (check) => check.name === "mcp-connection" && check.status === "pass"
          )
        ).toBe(true);
        expect(
          result.checks?.some(
            (check) =>
              check.name === "mcp-tool-catalog-match" && check.status === "pass"
          )
        ).toBe(true);
      });
    });
  }, 20_000);

  it("keeps doctor local-client resolution aligned between source and dist entrypoints", async () => {
    await withTempCwd(async (rootDir) => {
      await withTempHome(async (homeDir) => {
        const env = createCommandEnv(homeDir);
        await writeCwConfig(rootDir, homeDir, {
          workers: [
            {
              workerId: "local-worker",
              provider: "client",
              model: "qwen3-coder",
              clientCommand: "node"
            }
          ]
        });
        await writeRegistry(
          rootDir,
          homeDir,
          [
            createRegistration({
              workerId: "local-worker",
              provider: "client",
              model: "qwen3-coder"
            })
          ]
        );

        const [sourceDoctor, distDoctor] = await Promise.all([
          runSourceCli(["doctor", "--worker", "local-worker"], rootDir, env),
          runDistCli(["doctor", "--worker", "local-worker"], rootDir, env)
        ]);

        expect(normalizeDoctorReport(sourceDoctor.stdout)).toEqual(
          normalizeDoctorReport(distDoctor.stdout)
        );
      });
    });
  }, 20_000);

  it("keeps worker interview results aligned between source and dist entrypoints", async () => {
    await withTempCwd(async (rootDir) => {
      await withTempHome(async (homeDir) => {
        const workerId = "parity-worker";
        const env = createCommandEnv(homeDir);
        await writeRegistry(
          rootDir,
          homeDir,
          [
            createRegistration({
              workerId,
              provider: "mock",
              model: "gpt-5.4-mini"
            })
          ]
        );

        const [sourceInterview, distInterview] = await Promise.all([
          runSourceCli(["worker", "interview", "--worker", workerId], rootDir, env),
          runDistCli(["worker", "interview", "--worker", workerId], rootDir, env)
        ]);

        expect(normalizeWorkerInterview(sourceInterview.stdout)).toEqual(
          normalizeWorkerInterview(distInterview.stdout)
        );
      });
    });
  }, 20_000);
});
