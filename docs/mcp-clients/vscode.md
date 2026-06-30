# VS Code MCP Setup

Use this guide when connecting `mcp-code-worker` to a VS Code MCP-capable extension or integration.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host=vscode
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

After applying the snippet:

- run `cw mcp list-tools` locally and compare the expected tool list
- confirm the VS Code-side integration can connect and list the same tools
- keep runtime worker/provider settings in `config.json` and make sure VS Code launches `cw` from the target workspace root
