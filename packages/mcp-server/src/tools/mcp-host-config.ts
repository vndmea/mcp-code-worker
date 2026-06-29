export const MCP_HOSTS = [
  "generic",
  "codex",
  "cursor",
  "vscode",
  "claude-desktop",
  "opencode"
] as const;

export type McpHost = (typeof MCP_HOSTS)[number];

export const isMcpHost = (value: string): value is McpHost =>
  MCP_HOSTS.includes(value as McpHost);

export const buildMcpConfigSnippet = (options: {
  args?: string[];
  command?: string;
  host?: string;
} = {}) => {
  const args = [...(options.args ?? ["mcp", "serve"])];
  const requestedHost = options.host ?? "generic";

  if (!isMcpHost(requestedHost)) {
    throw new Error(
      `Unsupported MCP host '${requestedHost}'. Expected one of: ${MCP_HOSTS.join(", ")}.`
    );
  }

  return {
    mcpServers: {
      "mcp-code-worker": {
        command: options.command ?? "cw",
        args
      }
    }
  };
};
