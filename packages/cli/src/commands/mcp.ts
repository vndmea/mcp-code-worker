import type { Command } from "commander";

import {
  buildMcpToolCatalogView,
  serveCwMcpServer
} from "@mcp-code-worker/mcp-server";
import { normalizeFileSystemPath } from "@mcp-code-worker/core";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

const MCP_HOSTS = [
  "generic",
  "codex",
  "cursor",
  "vscode",
  "claude-desktop",
  "opencode"
] as const;

type McpHost = (typeof MCP_HOSTS)[number];

const isMcpHost = (value: string): value is McpHost =>
  MCP_HOSTS.includes(value as McpHost);

const getHostPresetRootDir = (host: McpHost): string | undefined => {
  switch (host) {
    case "codex":
    case "cursor":
    case "vscode":
      return "${workspaceFolder}";
    default:
      return undefined;
  }
};

export const buildMcpConfigSnippet = (options: {
  args?: string[];
  command?: string;
  cwHomeDir?: string;
  host?: string;
  rootDir?: string;
} = {}) => {
  const args = [...(options.args ?? ["mcp", "serve"])];
  const env: Record<string, string> = {};
  const requestedHost = options.host ?? "generic";

  if (!isMcpHost(requestedHost)) {
    throw new Error(
      `Unsupported MCP host '${requestedHost}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
    );
  }

  if (options.rootDir) {
    env.CW_ROOT_DIR = normalizeFileSystemPath(options.rootDir);
  } else {
    const hostRootDir = getHostPresetRootDir(requestedHost);

    if (hostRootDir) {
      env.CW_ROOT_DIR = hostRootDir;
    }
  }

  if (options.cwHomeDir) {
    env.CW_HOME_DIR = normalizeFileSystemPath(options.cwHomeDir);
  }

  return {
    mcpServers: {
      "mcp-code-worker": {
        command: options.command ?? "cw",
        args,
        ...(Object.keys(env).length > 0 ? { env } : {})
      }
    }
  };
};

export const registerMcpCommand = (program: Command, io: CliIo): void => {
  const mcp = program.command("mcp").description("Manage the MCP server.");

  mcp
    .command("serve")
    .description("Start the stdio MCP server.")
    .action(async () => {
      await serveCwMcpServer();
    });

  mcp
    .command("list-tools")
    .description("List MCP tool definitions grouped by recommended entrypoint and tool type.")
    .action(() => {
      const catalog = buildMcpToolCatalogView();

      writeOutput(
        io,
        catalog,
        [
          "mcp tools",
          ...catalog.groups.map(
            (group) =>
              `${group.category}: ${group.tools.map((tool) => tool.name).join(", ")}`
          )
        ]
      );
    });

  mcp
    .command("config")
    .description("Print a minimal local MCP stdio server config snippet. Worker, validation, and safety settings should live in cw config.json.")
    .option("--command <command>", "Command to launch the server", "cw")
    .option("--args <args...>", "Arguments passed to the command")
    .option(
      "--host <name>",
      `Target host preset: ${MCP_HOSTS.join(", ")}`,
      "generic"
    )
    .option(
      "--root-dir <path>",
      "Embed CW_ROOT_DIR in the snippet when the host does not launch cw from the target workspace root."
    )
    .option(
      "--home-dir <path>",
      "Embed CW_HOME_DIR in the snippet when CW-managed state should use a custom home root."
    )
    .action((options: {
      args?: string[];
      command: string;
      host: string;
      homeDir?: string;
      rootDir?: string;
    }) => {
      if (!isMcpHost(options.host)) {
        throw new Error(
          `Unsupported MCP host '${options.host}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
        );
      }

      io.write(
        JSON.stringify(
          buildMcpConfigSnippet({
            args: options.args,
            command: options.command,
            host: options.host,
            ...(options.homeDir ? { cwHomeDir: options.homeDir } : {}),
            ...(options.rootDir ? { rootDir: options.rootDir } : {})
          }),
          null,
          2
        )
      );
    });
};
