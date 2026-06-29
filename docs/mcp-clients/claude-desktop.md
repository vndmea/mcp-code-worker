# Claude Desktop MCP Setup

Use this guide when connecting `mcp-code-worker` to Claude Desktop through the client's MCP configuration surface.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host claude-desktop
```

```json
{
  "mcpServers": {
    "mcp-code-worker": {
      "command": "cw",
      "args": ["mcp", "serve"]
    }
  }
}
```

## Validation Loop

Before saving the client configuration:

- run `cw doctor`
- run `cw mcp list-tools`
- confirm `cw mcp serve` starts cleanly from the target workspace root

If Claude Desktop launches the server from a location other than the repository root, change the launch path so `cw mcp serve` starts inside the target repository.
