import type { Command } from "commander";

import {
  buildMcpToolCatalogView,
  serveCwMcpServer
} from "@mcp-code-worker/mcp-server";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value
];

const parseEnvAssignments = (
  assignments: string[]
): Record<string, string> => {
  const env: Record<string, string> = {};

  for (const assignment of assignments) {
    const separatorIndex = assignment.indexOf("=");

    if (separatorIndex <= 0) {
      throw new Error(
        `Invalid --env assignment '${assignment}'. Expected KEY=VALUE.`
      );
    }

    const key = assignment.slice(0, separatorIndex).trim();
    const value = assignment.slice(separatorIndex + 1);

    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
      throw new Error(
        `Invalid environment variable name '${key}' in --env assignment.`
      );
    }

    env[key] = value;
  }

  return env;
};

export const buildMcpConfigSnippet = (options: {
  args?: string[];
  command?: string;
  env?: Record<string, string>;
} = {}) => {
  const args = [...(options.args ?? ["mcp", "serve"])];
  const env = {
    ...(options.env ?? {})
  };

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
    .description("Print a minimal local MCP stdio server config snippet. Worker selection stays in cw config and registry state.")
    .option("--command <command>", "Command to launch the server", "cw")
    .option("--args <args...>", "Arguments passed to the command")
    .option(
      "--env <assignment>",
      "Add an environment variable assignment such as CW_HOME_DIR=C:\\\\Users\\\\me\\\\.cw",
      collect,
      []
    )
    .action((options: {
      args?: string[];
      command: string;
      env: string[];
    }) => {
      io.write(
        JSON.stringify(
          buildMcpConfigSnippet({
            args: options.args,
            command: options.command,
            env: parseEnvAssignments(options.env)
          }),
          null,
          2
        )
      );
    });
};
