import type { Command } from "commander";

import {
  buildMcpConfigSnippet,
  buildMcpToolCatalogView,
  isMcpHost,
  MCP_HOSTS,
  serveCwMcpServer,
  type McpHost
} from "@mcp-code-worker/mcp-server";

import type { CliIo } from "../index.js";
import { writeOutput } from "../output.js";

export { buildMcpConfigSnippet, isMcpHost, MCP_HOSTS, type McpHost };

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
    .action((options: {
      args?: string[];
      command: string;
      host: string;
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
            host: options.host
          }),
          null,
          2
        )
      );
    });
};
