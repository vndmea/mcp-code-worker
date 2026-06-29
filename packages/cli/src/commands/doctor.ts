import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import type { Command } from "commander";

import {
  resolveExecutionContext,
  type DoctorCapability,
  type DoctorCheck,
  type DoctorReport,
  type DoctorStatus,
  type ExecutionContext,
  writeAuditEvent
} from "@mcp-code-worker/core";
import { buildMcpToolCatalogView } from "@mcp-code-worker/mcp-server";
import { buildDoctorReport } from "@mcp-code-worker/models";

import type { CliIo } from "../index.js";
import type { McpHost } from "./mcp.js";
import {
  buildMcpConfigSnippet,
  isMcpHost,
  MCP_HOSTS
} from "./mcp.js";
import { writeOutput } from "../output.js";

const HOST_MCP_CHECK_NAMES = [
  "host-config-present",
  "host-config-valid",
  "mcp-server-launchable",
  "mcp-connection",
  "mcp-tool-catalog-match"
] as const;

const HOST_MCP_CHECK_NAME_SET = new Set<string>(HOST_MCP_CHECK_NAMES);
const HOST_MCP_RUNTIME_ENV_KEYS = new Set([
  "WORKER_MODEL_PROVIDER",
  "WORKER_MODEL_NAME",
  "WORKER_MODEL_BASE_URL",
  "WORKER_MODEL_API_KEY",
  "CW_WORKER_CLIENT_COMMAND"
]);
const SERVER_KEY = "mcp-code-worker";
const MCP_CONNECTION_TIMEOUT_MS = 20_000;
const MCP_CONNECTION_ATTEMPTS = 2;

interface HostMcpConfigInspection {
  args: string[];
  command?: string;
  configPath: string | null;
  env: Record<string, string>;
  exists: boolean;
  host: McpHost;
  pathDiscoverySupported: boolean;
  rawContents: string | null;
  runtimeEnvKeys: string[];
  serverEntryFound: boolean;
}

interface McpConnectionResult {
  error?: string;
  stderr: string;
  toolNames: string[];
}

const readMetadataString = (
  metadata: Record<string, unknown>,
  key: string,
  fallback: string
): string => {
  const value = metadata[key];

  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
};

const readMetadataDisplayValue = (
  metadata: Record<string, unknown> | undefined,
  key: string,
  fallback: string
): string => {
  if (!metadata) {
    return fallback;
  }

  const value = metadata[key];

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return fallback;
};

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
    env: {},
    runtimeEnvKeys: []
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

  inspection.runtimeEnvKeys = Object.keys(inspection.env).filter((key) =>
    HOST_MCP_RUNTIME_ENV_KEYS.has(key)
  );

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
      env: {},
      runtimeEnvKeys: []
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
  env: Record<string, string>;
  summary: string;
} => {
  const snippet = buildMcpConfigSnippet({ host });
  const server = snippet.mcpServers[SERVER_KEY];
  const env = server.env ?? {};
  const envSummary =
    Object.keys(env).length > 0
      ? Object.entries(env)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
      : "(none)";

  return {
    command: server.command,
    args: server.args,
    env,
    summary: `command=${server.command}; args=[${server.args.join(", ")}]; env={${envSummary}}`
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

const createHostMcpDoctorChecks = async (
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
  const envMatches = Object.entries(expected.env).every(
    ([key, value]) => inspection.env[key] === value
  );
  const validHostSnippet =
    inspection.serverEntryFound &&
    commandMatches &&
    argsMatch &&
    envMatches &&
    inspection.runtimeEnvKeys.length === 0;
  const foundSummary = inspection.serverEntryFound
    ? `command=${inspection.command ?? "(missing)"}; args=[${inspection.args.join(", ")}]; env={${Object.entries(inspection.env)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ") || "(none)"}}`
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
  if (!envMatches) {
    mismatchReasons.push(
      `env should include ${Object.entries(expected.env)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}`
    );
  }
  if (inspection.runtimeEnvKeys.length > 0) {
    mismatchReasons.push(
      `launch-only MCP env should not include ${inspection.runtimeEnvKeys.join(", ")}`
    );
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

const buildHostMcpCapability = (
  host: McpHost,
  checks: DoctorCheck[]
): DoctorCapability => {
  const relevantChecks = checks.filter((check) => HOST_MCP_CHECK_NAME_SET.has(check.name));
  const status: DoctorStatus = relevantChecks.every((check) => check.status === "pass")
    ? "ready"
    : "unavailable";

  return {
    name: "host-mcp-integration",
    available: status === "ready",
    status,
    summary:
      status === "ready"
        ? `${host} host MCP wiring matches the recommended snippet and the stdio server is reachable.`
        : `${host} host MCP wiring still needs attention before host-side discovery can be trusted.`
  };
};

const applyHostMcpCapability = (
  report: DoctorReport,
  host: McpHost
): void => {
  const capability = buildHostMcpCapability(host, report.checks);
  report.capabilities.push(capability);

  if (capability.status === "unavailable") {
    report.status = "unavailable";
    report.ok = false;
    report.summary =
      report.summary.startsWith("unavailable:")
        ? `${report.summary} Host MCP integration for ${host} also needs attention.`
        : `unavailable: cw is bound to ${report.activeRootDir}, but host MCP integration for ${host} still needs attention before the workflow is reliable.`;
  } else if (report.status === "ready") {
    report.summary = `ready: cw is bound to ${report.activeRootDir}, core task workflows are available, and host MCP integration for ${host} is ready.`;
  }
};

const formatDoctorReport = (report: DoctorReport): string[] => {
  const failedChecks = report.checks.filter((check) => check.status === "fail");
  const warningChecks = report.checks.filter((check) => check.status === "warning");
  const doctorStatus: string = report.status;
  const doctorSummary: string = report.summary;
  const activeRootDir: string = report.activeRootDir;
  const capabilityPairs: string[] = [];
  const runtimeBootstrap = report.checks.find(
    (check) => check.name === "runtime-bootstrap"
  );
  const rootCheck = report.checks.find((check) => check.name === "root-dir");
  const workerModel = report.checks.find((check) => check.name === "worker-model");
  const workerConnectivity = report.checks.find(
    (check) => check.name === "worker-connectivity"
  );
  const hostMcpChecks = report.checks.filter((check) =>
    HOST_MCP_CHECK_NAME_SET.has(check.name)
  );

  for (const capability of report.capabilities) {
    capabilityPairs.push(`${capability.name}=${capability.status}`);
  }

  const capabilitySummary: string = capabilityPairs.join(", ");
  const lines: string[] = [];

  lines.push(`cw doctor: ${doctorStatus}`);
  lines.push(doctorSummary);
  lines.push(`workspace: ${activeRootDir}`);
  if (rootCheck?.metadata) {
    lines.push(
      `binding: rootSource=${readMetadataString(rootCheck.metadata, "rootSource", "unknown")} | caller=${readMetadataString(rootCheck.metadata, "callerWorkingDirectory", "unknown")}`
    );
  }
  if (runtimeBootstrap?.metadata) {
    lines.push(
      `paths: config=${readMetadataString(runtimeBootstrap.metadata, "configPath", "unknown")} | storage=${readMetadataString(runtimeBootstrap.metadata, "cwStorageDir", "unknown")} | home=${readMetadataString(runtimeBootstrap.metadata, "cwHomeDir", "unknown")}`
    );
    const env = runtimeBootstrap.metadata["env"];
    if (env && typeof env === "object") {
      const runtimeEnv = env as Record<string, unknown>;
      lines.push(
        `env: CW_WORKSPACE_DIR=${readMetadataString(runtimeEnv, "CW_WORKSPACE_DIR", "(default)")} | CW_STORAGE_DIR=${readMetadataString(runtimeEnv, "CW_STORAGE_DIR", "(default)")} | apiKeyEnv=${readMetadataString(runtimeEnv, "WORKER_MODEL_API_KEY", "(missing)")}`
      );
    }
  }
  if (workerModel?.metadata) {
    lines.push(
      `worker: provider=${readMetadataString(workerModel.metadata, "provider", "unknown")} | model=${readMetadataString(workerModel.metadata, "model", "unknown")} | baseURL=${readMetadataString(workerModel.metadata, "baseURL", "(default)")} | client=${readMetadataString(workerModel.metadata, "clientCommand", "(default)")}`
    );
  }
  if (workerConnectivity?.metadata) {
    lines.push(
      `probe: worker=${readMetadataString(workerConnectivity.metadata, "workerId", "(default-worker)")} | source=${readMetadataString(workerConnectivity.metadata, "source", "default")} | provider=${readMetadataString(workerConnectivity.metadata, "provider", "unknown")} | model=${readMetadataString(workerConnectivity.metadata, "model", "unknown")} | baseURL=${readMetadataString(workerConnectivity.metadata, "baseURL", "(default)")} | client=${readMetadataString(workerConnectivity.metadata, "clientCommand", "(default)")}`
    );
  }
  if (hostMcpChecks.length > 0) {
    lines.push(
      `mcp host: ${readMetadataDisplayValue(hostMcpChecks[0]?.metadata, "host", "unknown")}`
    );
    for (const check of hostMcpChecks) {
      lines.push(
        `mcp ${check.name}: ${check.status} | found=${readMetadataDisplayValue(check.metadata, "found", "(unknown)")} | expected=${readMetadataDisplayValue(check.metadata, "expected", "(unknown)")}`
      );
      lines.push(
        `mcp ${check.name} fix: ${readMetadataDisplayValue(check.metadata, "fix", "(none)")}`
      );
    }
  }
  lines.push(`capabilities: ${capabilitySummary}`);

  if (failedChecks.length > 0) {
    lines.push(
      `blocking: ${failedChecks
        .slice(0, 3)
        .map((check) => `${check.name}: ${check.message}`)
        .join(" | ")}`
    );
  }

  if (warningChecks.length > 0) {
    lines.push(
      `warnings: ${warningChecks
        .slice(0, 3)
        .map((check) => `${check.name}: ${check.message}`)
        .join(" | ")}`
    );
  }

  if (report.recommendedActions.length > 0) {
    lines.push(`next: ${report.recommendedActions.slice(0, 3).join(" | ")}`);
  }

  return lines;
};

export const registerDoctorCommand = (program: Command, io: CliIo): void => {
  program
    .command("doctor")
    .description("Inspect resolved configuration and local workflow prerequisites.")
    .option(
      "--probe",
      "Run a real worker connectivity probe after the static prerequisite checks.",
      false
    )
    .option(
      "--mcp",
      "Run host-level MCP configuration, launchability, connectivity, and tool-catalog checks.",
      false
    )
    .option(
      "--host <name>",
      `Target host preset for --mcp checks: ${MCP_HOSTS.join(", ")}`,
      "codex"
    )
    .action(async (options: { host?: string; mcp?: boolean; probe?: boolean }) => {
      const requestedHost = options.host ?? "codex";

      if (!isMcpHost(requestedHost)) {
        throw new Error(
          `Unsupported MCP host '${requestedHost}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
        );
      }

      const context = await resolveExecutionContext();
      const hostChecks = options.mcp
        ? await createHostMcpDoctorChecks(context, requestedHost)
        : [];
      const report = await buildDoctorReport({
        additionalChecks: hostChecks,
        context,
        probe: options.probe,
        transformReport: options.mcp
          ? (currentReport) => {
              applyHostMcpCapability(currentReport, requestedHost);
            }
          : undefined
      });

      const commandParts = ["cw", "doctor"];
      if (options.probe) {
        commandParts.push("--probe");
      }
      if (options.mcp) {
        commandParts.push("--mcp", "--host", requestedHost);
      }

      await writeAuditEvent(context, {
        actor: "cli",
        action: "doctor",
        mode: context.dryRun ? "dry-run" : "execute",
        inputSummary: commandParts.join(" "),
        outputSummary: `Doctor completed with ok=${String(report.ok)}.`,
        warnings: report.checks
          .filter((check) => check.status === "warning")
          .map((check) => check.message),
        errors: report.checks
          .filter((check) => check.status === "fail")
          .map((check) => check.message)
      });

      writeOutput(io, report, formatDoctorReport(report));
    });
};
