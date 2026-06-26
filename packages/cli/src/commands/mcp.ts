import type { Command } from "commander";

import {
  aoToolDefinitions,
  buildMcpToolCatalogView,
  serveAoMcpServer
} from "@agent-orchestrator/mcp-server";

import type { CliIo } from "../index.js";

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

      io.write(JSON.stringify(catalog, null, 2));
    });

  mcp
    .command("config")
    .description("Print a generic local MCP stdio server config snippet.")
    .option("--command <command>", "Command to launch the server", "ao")
    .option("--args <args...>", "Arguments passed to the command")
    .option(
      "--root <path>",
      "Embed an explicit root directory, for example ${workspaceFolder}."
    )
    .action((options: { args?: string[]; command: string; root?: string }) => {
      const args = options.args ?? ["mcp", "serve"];

      if (options.root) {
        args.push("--root", options.root);
      }

      io.write(
        JSON.stringify(
          {
            mcpServers: {
              "agent-orchestrator": {
                command: options.command,
                args
              }
            }
          },
          null,
          2
        )
      );
    });
};
