import type { Command } from "commander";

import { aoToolDefinitions, serveAoMcpServer } from "@agent-orchestrator/mcp-server";

import type { CliIo } from "../index.js";

export const registerMcpCommand = (program: Command, io: CliIo): void => {
  const mcp = program.command("mcp").description("Manage the MCP server.");

  mcp
    .command("serve")
    .description("Start the stdio MCP server.")
    .action(async () => {
      await serveAoMcpServer();
    });

  mcp
    .command("list-tools")
    .description("List MCP tool definitions.")
    .action(() => {
      io.write(
        JSON.stringify(
          aoToolDefinitions.map((tool) => ({
            name: tool.name,
            description: tool.description
          })),
          null,
          2
        )
      );
    });

  mcp
    .command("config")
    .description("Print a generic local MCP stdio server config snippet.")
    .option("--command <command>", "Command to launch the server", "ao")
    .option("--args <args...>", "Arguments passed to the command")
    .action((options: { args?: string[]; command: string }) => {
      io.write(
        JSON.stringify(
          {
            mcpServers: {
              "agent-orchestrator": {
                command: options.command,
                args: options.args ?? ["mcp", "serve"]
              }
            }
          },
          null,
          2
        )
      );
    });
};
