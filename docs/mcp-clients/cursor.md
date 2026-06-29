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
      "args": ["mcp", "serve"]
    }
  }
}
```

## Notes

- `cw mcp config` is the quickest way to compare the expected stdio snippet with what you pasted into the client.
- Keep worker/provider/local-client defaults in `config.json`.
- If the client starts from a shared tools checkout, switch it to launch `cw mcp serve` from the active workspace instead of relying on environment overrides.
