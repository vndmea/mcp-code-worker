# Codex MCP Setup

Use this guide when `mcp-code-worker` is launched as an MCP server from Codex.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host codex
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

## Verification

Before relying on the client integration:

- run `cw doctor`
- run `cw doctor --mcp --host codex`
- run `cw mcp list-tools`
- run `cw mcp config`

Keep runtime worker and safety settings in `config.json`; use the MCP snippet only for launch wiring, and make sure Codex starts it from the intended workspace root.
