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
      "args": ["mcp", "serve"],
      "env": {
        "CW_ROOT_DIR": "${workspaceFolder}"
      }
    }
  }
}
```

## Verification

Before relying on the client integration:

- run `cw doctor`
- run `cw mcp list-tools`
- run `cw mcp config`

Keep runtime worker and safety settings in `config.json`; use the MCP snippet only for launch wiring such as `CW_ROOT_DIR` when needed.
