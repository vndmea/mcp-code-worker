# Cursor MCP Setup

Use this guide when configuring `mcp-code-worker` inside Cursor.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host cursor
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

## Notes

- `cw mcp config` is the quickest way to compare the expected stdio snippet with what you pasted into the client.
- Keep worker/provider/local-client defaults in `config.json`.
- If the client starts from a shared tools checkout, `CW_ROOT_DIR` is what keeps file access and CW state aligned to the active workspace.
