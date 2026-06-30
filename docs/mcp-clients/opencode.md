# OpenCode MCP Setup

Use this guide when `mcp-code-worker` is launched as an MCP server from OpenCode or when OpenCode-compatible local client behavior is part of your workflow.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host=opencode
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

## Root Resolution

Launch the server from the intended workspace root. If OpenCode starts it from elsewhere, change the launch path instead of relying on environment overrides.

## Local Client Provider Note

If you also use the local client provider bridge, `opencode` is the default compatible command. Persist a different executable name or path with `workerClientCommand` in `config.json` when needed.
