import type { Command } from "commander";

import {
  buildMcpToolCatalogView,
  serveAoMcpServer
} from "@agent-orchestrator/mcp-server";

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

export const registerMcpCommand = (program: Command, io: CliIo): void => {
  const mcp = program.command("mcp").description("Manage the MCP server.");

  mcp
    .command("serve")
    .description("Start the stdio MCP server.")
    .option(
      "--root <path>",
      "Resolve MCP workspace state from this root directory instead of the launch cwd."
    )
    .action(async (options: { root?: string }) => {
      if (options.root) {
        process.env.AO_ROOT_DIR = options.root;
      }

      await serveAoMcpServer({
        rootDir: options.root
      });
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
    .description("Print a generic local MCP stdio server config snippet.")
    .option("--command <command>", "Command to launch the server", "ao")
    .option("--args <args...>", "Arguments passed to the command")
    .option(
      "--env <assignment>",
      "Add an environment variable assignment such as AO_HOME_DIR=C:\\\\Users\\\\me\\\\.ao",
      collect,
      []
    )
    .option(
      "--root <path>",
      "Embed an explicit root directory, for example ${workspaceFolder}."
    )
    .option(
      "--worker-client-command <command>",
      "Set AO_WORKER_CLIENT_COMMAND in the generated snippet when you need a non-default compatible CLI."
    )
    .action((options: {
      args?: string[];
      command: string;
      env: string[];
      root?: string;
      workerClientCommand?: string;
    }) => {
      const args = options.args ?? ["mcp", "serve"];
      const env = parseEnvAssignments(options.env);

      if (options.root) {
        args.push("--root", options.root);
      }

      if (options.workerClientCommand) {
        env.AO_WORKER_CLIENT_COMMAND = options.workerClientCommand;
      }

      io.write(
        JSON.stringify(
          {
            mcpServers: {
              "agent-orchestrator": {
                command: options.command,
                args,
                ...(Object.keys(env).length > 0 ? { env } : {})
              }
            }
          },
          null,
          2
        )
      );
    });
};
