import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import type { DoctorCheck, ExecutionContext } from "@mcp-code-worker/core";

import { buildMcpToolCatalogView } from "./mcp-tool-catalog.js";
import {
  buildMcpConfigSnippet,
  type McpHost
} from "./mcp-host-config.js";

const SERVER_KEY = "mcp-code-worker";
const MCP_CONNECTION_TIMEOUT_MS = 20_000;
const MCP_CONNECTION_ATTEMPTS = 2;

export interface HostMcpConfigInspection {
  args: string[];
  command?: string;
  configPath: string | null;
  env: Record<string, string>;
  exists: boolean;
  host: McpHost;
  pathDiscoverySupported: boolean;
  rawContents: string | null;
  serverEntryFound: boolean;
}

interface McpConnectionResult {
  error?: string;
  stderr: string;
  toolNames: string[];
}

const resolveHomeDirectory = (env: NodeJS.ProcessEnv): string => {
  const home = env.USERPROFILE ?? env.HOME;

  if (home && home.trim().length > 0) {
    return home;
  }

  if (env.HOMEDRIVE && env.HOMEPATH) {
    return `${env.HOMEDRIVE}${env.HOMEPATH}`;
  }

  return homedir();
};

const normalizeTomlTableName = (value: string): string =>
  value.replace(/["'\s]/gu, "");

const parseTomlQuotedString = (value: string): string | null => {
  const trimmed = value.trim();

  if (trimmed.startsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return null;
};

const parseTomlStringArray = (value: string): string[] => {
  const matches = value.match(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/gu) ?? [];

  return matches
    .map((match) => parseTomlQuotedString(match))
    .filter((entry): entry is string => entry !== null);
};

const parseTomlInlineEnv = (value: string): Record<string, string> => {
  const match = value.match(/^\s*env\s*=\s*\{(?<body>.*)\}\s*$/u);

  if (!match?.groups?.body) {
    return {};
  }

  const env: Record<string, string> = {};
  const body = match.groups.body;
  const entryPattern =
    /([A-Za-z0-9_:-]+)\s*=\s*("((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/gu;

  for (const entry of body.matchAll(entryPattern)) {
    const key = entry[1]?.trim();
    const rawValue = entry[2];
    const parsedValue = rawValue ? parseTomlQuotedString(rawValue) : null;

    if (key && parsedValue !== null) {
      env[key] = parsedValue;
    }
  }

  return env;
};

const inspectCodexHostConfig = (
  host: McpHost,
  contents: string | null,
  configPath: string | null
): HostMcpConfigInspection => {
  const inspection: HostMcpConfigInspection = {
    host,
    configPath,
    exists: Boolean(contents !== null && configPath),
    pathDiscoverySupported: true,
    rawContents: contents,
    serverEntryFound: false,
    args: [],
    env: {}
  };

  if (!contents) {
    return inspection;
  }

  const lines = contents.split(/\r?\n/u);
  let inServerTable = false;
  let inEnvTable = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\s*\[(?<name>.+?)\]\s*$/u);

    if (tableMatch?.groups?.name) {
      const tableName = normalizeTomlTableName(tableMatch.groups.name);
      inServerTable =
        tableName.endsWith(`.${SERVER_KEY}`) ||
        tableName === SERVER_KEY ||
        tableName === `mcp_servers.${SERVER_KEY}`;
      inEnvTable =
        tableName.endsWith(`.${SERVER_KEY}.env`) ||
        tableName === `${SERVER_KEY}.env` ||
        tableName === `mcp_servers.${SERVER_KEY}.env`;

      if (inServerTable || inEnvTable) {
        inspection.serverEntryFound = true;
      }

      continue;
    }

    if (!inServerTable && !inEnvTable) {
      continue;
    }

    if (inEnvTable) {
      const envLine = line.match(
        /^\s*([A-Za-z0-9_:-]+)\s*=\s*("((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*$/u
      );

      if (envLine?.[1] && envLine[2]) {
        const parsedValue = parseTomlQuotedString(envLine[2]);

        if (parsedValue !== null) {
          inspection.env[envLine[1]] = parsedValue;
        }
      }

      continue;
    }

    const commandLine = line.match(/^\s*command\s*=\s*(.+?)\s*$/u);
    if (commandLine?.[1]) {
      const parsedCommand = parseTomlQuotedString(commandLine[1]);

      if (parsedCommand) {
        inspection.command = parsedCommand;
      }

      continue;
    }

    const argsLine = line.match(/^\s*args\s*=\s*(.+?)\s*$/u);
    if (argsLine?.[1]) {
      inspection.args = parseTomlStringArray(argsLine[1]);
      continue;
    }

    const inlineEnv = parseTomlInlineEnv(line);
    if (Object.keys(inlineEnv).length > 0) {
      Object.assign(inspection.env, inlineEnv);
    }
  }

  return inspection;
};

const inspectHostMcpConfig = async (
  host: McpHost,
  env: NodeJS.ProcessEnv
): Promise<HostMcpConfigInspection> => {
  if (host !== "codex") {
    return {
      host,
      configPath: null,
      exists: false,
      pathDiscoverySupported: false,
      rawContents: null,
      serverEntryFound: false,
      args: [],
      env: {}
    };
  }

  const configPath = join(resolveHomeDirectory(env), ".codex", "config.toml");
  let contents: string | null = null;

  try {
    contents = await readFile(configPath, "utf8");
  } catch {
    contents = null;
  }

  return inspectCodexHostConfig(host, contents, configPath);
};

const buildExpectedServerSummary = (host: McpHost): {
  args: string[];
  command: string;
  summary: string;
} => {
  const snippet = buildMcpConfigSnippet({ host });
  const server = snippet.mcpServers[SERVER_KEY];

  return {
    command: server.command,
    args: server.args,
    summary: `command=${server.command}; args=[${server.args.join(", ")}]`
  };
};

const buildCommandCandidates = (
  command: string,
  env: NodeJS.ProcessEnv
): string[] => {
  const isWindows = process.platform === "win32";
  const pathExt = isWindows
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  const hasExplicitExtension = /\.[^./\\]+$/u.test(command);
  const suffixes = hasExplicitExtension || !isWindows ? [""] : ["", ...pathExt];
  const bases =
    isAbsolute(command) || command.includes("/") || command.includes("\\")
      ? [command]
      : (env.PATH ?? "")
          .split(delimiter)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .map((entry) => join(entry, command));

  const candidates: string[] = [];

  for (const base of bases) {
    for (const suffix of suffixes) {
      candidates.push(`${base}${suffix}`);
    }
  }

  return Array.from(new Set(candidates));
};

const resolveCommandOnPath = async (
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> => {
  const accessMode = process.platform === "win32"
    ? constants.F_OK
    : constants.X_OK;

  for (const candidate of buildCommandCandidates(command, env)) {
    try {
      await access(candidate, accessMode);
      return candidate;
    } catch {
      // Keep scanning.
    }
  }

  return null;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const flattenToolNames = (): string[] => {
  const catalog = buildMcpToolCatalogView();

  return catalog.groups
    .flatMap((group) => group.tools.map((tool) => tool.name))
    .sort();
};

const toProcessEnvRecord = (
  env: NodeJS.ProcessEnv,
  overrides: Record<string, string>
): Record<string, string> => {
  const merged: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      merged[key] = value;
    }
  }

  return {
    ...merged,
    ...overrides
  };
};

const sleep = async (timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

const checkMcpConnection = async (
  context: ExecutionContext,
  inspection: HostMcpConfigInspection
): Promise<McpConnectionResult> => {
  if (!inspection.command) {
    return {
      error: "No MCP server command could be parsed from the host configuration.",
      stderr: "",
      toolNames: []
    };
  }

  let lastError = "Unknown MCP connection failure.";
  let lastStderr = "";

  for (let attempt = 1; attempt <= MCP_CONNECTION_ATTEMPTS; attempt += 1) {
    const transport = new StdioClientTransport({
      command: inspection.command,
      args: inspection.args,
      cwd: context.rootDir,
      env: toProcessEnvRecord(process.env, inspection.env),
      stderr: "pipe"
    });
    const stderrStream = transport.stderr;
    let stderr = "";

    stderrStream?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const client = new Client(
      {
        name: "cw-doctor",
        version: "0.1.0"
      },
      {
        capabilities: {}
      }
    );

    try {
      await withTimeout(
        client.connect(transport),
        MCP_CONNECTION_TIMEOUT_MS,
        `MCP connect (attempt ${attempt})`
      );
      const tools = await withTimeout(
        client.listTools(),
        MCP_CONNECTION_TIMEOUT_MS,
        `MCP listTools (attempt ${attempt})`
      );

      return {
        stderr: stderr.trim(),
        toolNames: tools.tools.map((tool) => tool.name).sort()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError =
        attempt === 1 && MCP_CONNECTION_ATTEMPTS > 1
          ? `${message} Retrying once.`
          : message;
      lastStderr = stderr.trim();
      if (attempt < MCP_CONNECTION_ATTEMPTS) {
        await sleep(250);
      }
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  return {
    error: lastError,
    stderr: lastStderr,
    toolNames: []
  };
};

export const createHostMcpDoctorChecks = async (
  context: ExecutionContext,
  host: McpHost
): Promise<DoctorCheck[]> => {
  const inspection = await inspectHostMcpConfig(host, process.env);
  const expected = buildExpectedServerSummary(host);
  const checks: DoctorCheck[] = [];

  if (!inspection.pathDiscoverySupported) {
    checks.push({
      name: "host-config-present",
      status: "warning",
      message: `Automatic host config file discovery is not implemented for '${host}' yet.`,
      metadata: {
        host,
        found: "Automatic host config path discovery is unavailable.",
        expected: `Manually compare the host snippet against 'cw mcp config --host ${host}'.`,
        fix: `Open the ${host} MCP settings manually and compare them with 'cw mcp config --host ${host}'.`,
        status: "warning"
      }
    });
    checks.push({
      name: "host-config-valid",
      status: "warning",
      message: `Host config validation for '${host}' is currently manual-only.`,
      metadata: {
        host,
        found: "No host config file was auto-loaded.",
        expected: expected.summary,
        fix: `Paste the output of 'cw mcp config --host ${host}' into the host MCP settings and avoid putting worker/provider values in that snippet.`,
        status: "warning"
      }
    });
    checks.push({
      name: "mcp-server-launchable",
      status: "warning",
      message: `Launchability was not tested because '${host}' does not have an auto-discovered config file path yet.`,
      metadata: {
        host,
        found: "No executable command was extracted from a host config file.",
        expected: "A host config file with an executable MCP server command.",
        fix: `After the ${host} config is in place, rerun 'cw doctor --mcp --host ${host}'.`,
        status: "warning"
      }
    });
    checks.push({
      name: "mcp-connection",
      status: "warning",
      message: `MCP connectivity was not exercised because '${host}' could not be auto-inspected.`,
      metadata: {
        host,
        found: "No host server command was available for a live stdio connection test.",
        expected: "A host-launched MCP server that accepts a stdio connection.",
        fix: `Wire the ${host} MCP config first, then rerun 'cw doctor --mcp --host ${host}'.`,
        status: "warning"
      }
    });
    checks.push({
      name: "mcp-tool-catalog-match",
      status: "warning",
      message: `Tool catalog matching was skipped because the host MCP connection could not be exercised for '${host}'.`,
      metadata: {
        host,
        found: "No host-visible tool catalog was collected.",
        expected: `${flattenToolNames().length} tool(s) from 'cw mcp list-tools'.`,
        fix: `Get a successful MCP connection first, then rerun 'cw doctor --mcp --host ${host}'.`,
        status: "warning"
      }
    });

    return checks;
  }

  checks.push({
    name: "host-config-present",
    status: inspection.exists ? "pass" : "fail",
    message: inspection.exists
      ? `${host} host config exists at ${inspection.configPath}.`
      : `${host} host config is missing at ${inspection.configPath}.`,
    metadata: {
      host,
      found: inspection.exists
        ? inspection.configPath ?? "(unknown)"
        : "missing",
      expected: inspection.configPath ?? "(unknown)",
      fix: `Create or update ${inspection.configPath} with the output of 'cw mcp config --host ${host}'.`,
      status: inspection.exists ? "pass" : "fail"
    }
  });

  const commandMatches = inspection.command === expected.command;
  const argsMatch =
    inspection.args.length === expected.args.length &&
    inspection.args.every((value, index) => value === expected.args[index]);
  const validHostSnippet =
    inspection.serverEntryFound &&
    commandMatches &&
    argsMatch;
  const foundSummary = inspection.serverEntryFound
    ? `command=${inspection.command ?? "(missing)"}; args=[${inspection.args.join(", ")}]`
    : "No mcp-code-worker server entry was found.";
  const mismatchReasons: string[] = [];

  if (!inspection.serverEntryFound) {
    mismatchReasons.push("missing mcp-code-worker server entry");
  }
  if (!commandMatches) {
    mismatchReasons.push(`command should be '${expected.command}'`);
  }
  if (!argsMatch) {
    mismatchReasons.push(`args should be [${expected.args.join(", ")}]`);
  }
  checks.push({
    name: "host-config-valid",
    status: validHostSnippet ? "pass" : "fail",
    message: validHostSnippet
      ? `${host} host MCP snippet matches the recommended launch-only configuration.`
      : `${host} host MCP snippet differs from the recommended launch-only configuration: ${mismatchReasons.join("; ")}.`,
    metadata: {
      host,
      found: foundSummary,
      expected: expected.summary,
      fix: `Replace the ${SERVER_KEY} entry with the output of 'cw mcp config --host ${host}' and move worker/provider settings back into cw config.json.`,
      status: validHostSnippet ? "pass" : "fail"
    }
  });

  const launchCommand = inspection.command;
  const resolvedCommand = launchCommand
    ? await resolveCommandOnPath(launchCommand, process.env)
    : null;

  checks.push({
    name: "mcp-server-launchable",
    status: resolvedCommand ? "pass" : "fail",
    message: resolvedCommand
      ? `Host MCP command '${launchCommand}' resolves to ${resolvedCommand}.`
      : launchCommand
        ? `Host MCP command '${launchCommand}' was not found on PATH.`
        : "No host MCP command could be parsed from the host configuration.",
    metadata: {
      host,
      found: launchCommand
        ? resolvedCommand
          ? `command=${launchCommand}; resolvedPath=${resolvedCommand}`
          : `command=${launchCommand}; resolvedPath=(missing)`
        : "command=(missing)",
      expected: "An executable command that can start 'cw mcp serve'.",
      fix: launchCommand
        ? "Install the configured command on PATH, or point the host snippet at a concrete executable."
        : `Add the ${SERVER_KEY} MCP server entry before rerunning this check.`,
      status: resolvedCommand ? "pass" : "fail"
    }
  });

  if (!resolvedCommand) {
    checks.push({
      name: "mcp-connection",
      status: "warning",
      message: "MCP connectivity was skipped because the host command is not launchable yet.",
      metadata: {
        host,
        found: "No live stdio connection was attempted.",
        expected: "A live stdio connection that completes MCP initialization.",
        fix: "Fix the launch command first, then rerun 'cw doctor --mcp'.",
        status: "warning"
      }
    });
    checks.push({
      name: "mcp-tool-catalog-match",
      status: "warning",
      message: "Tool catalog matching was skipped because MCP connectivity is not ready yet.",
      metadata: {
        host,
        found: "No host-visible tool catalog was collected.",
        expected: `${flattenToolNames().length} tool(s) from 'cw mcp list-tools'.`,
        fix: "Get a successful MCP connection first, then rerun 'cw doctor --mcp'.",
        status: "warning"
      }
    });

    return checks;
  }

  const connection = await checkMcpConnection(context, inspection);
  checks.push({
    name: "mcp-connection",
    status: connection.error ? "fail" : "pass",
    message: connection.error
      ? `Host-launched MCP connection failed: ${connection.error}`
      : `Host-launched MCP server accepted a stdio connection and exposed ${connection.toolNames.length} tool(s).`,
    metadata: {
      host,
      found: connection.error
        ? `connection failed${connection.stderr ? `; stderr=${connection.stderr}` : ""}`
        : `connected; tools=${connection.toolNames.length}`,
      expected: "A live stdio connection that completes MCP initialization.",
      fix: connection.error
        ? "Launch the same command manually, inspect stderr, and compare the host snippet with 'cw mcp config --host ...'."
        : "No action needed.",
      status: connection.error ? "fail" : "pass"
    }
  });

  const expectedToolNames = flattenToolNames();
  const catalogsMatch =
    !connection.error &&
    connection.toolNames.length === expectedToolNames.length &&
    connection.toolNames.every((name, index) => name === expectedToolNames[index]);

  checks.push({
    name: "mcp-tool-catalog-match",
    status: connection.error ? "warning" : catalogsMatch ? "pass" : "fail",
    message: connection.error
      ? "Tool catalog comparison was skipped because the host MCP connection did not complete."
      : catalogsMatch
        ? "The host-visible MCP tool list matches 'cw mcp list-tools'."
        : "The host-visible MCP tool list does not match 'cw mcp list-tools'.",
    metadata: {
      host,
      found: connection.error
        ? "No host-visible tool catalog was collected."
        : `${connection.toolNames.length} tool(s): ${connection.toolNames.join(", ")}`,
      expected: `${expectedToolNames.length} tool(s): ${expectedToolNames.join(", ")}`,
      fix: connection.error
        ? "Fix MCP connectivity first, then rerun the host tool catalog check."
        : "Compare the host-visible tools with 'cw mcp list-tools' and remove stale or duplicate MCP registrations.",
      status: connection.error ? "warning" : catalogsMatch ? "pass" : "fail"
    }
  });

  return checks;
};
