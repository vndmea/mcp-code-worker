# VS Code MCP Setup

Use this guide when connecting `mcp-code-worker` to a VS Code MCP-capable extension or integration.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host vscode
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

After applying the snippet:

- run `cw mcp list-tools` locally and compare the expected tool list
- confirm the VS Code-side integration can connect and list the same tools
- keep runtime worker/provider settings in `config.json`; only add `CW_ROOT_DIR` when VS Code does not launch `cw` from the target workspace root
