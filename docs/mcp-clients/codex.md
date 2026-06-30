# Codex MCP Setup

Use this guide when `mcp-code-worker` is launched as an MCP server from Codex.

## Recommended Server Snippet

Generate the snippet with:

```bash
cw mcp config --host=codex
```

Paste it into your user-level Codex config file at `~/.codex/config.toml`
for example `C:\Users\<user>\.codex\config.toml` on Windows:

```toml
[mcp_servers."mcp-code-worker"]
command = "cw"
args = ["mcp", "serve"]
```

`cw init` only offers opt-in writing to this file when it already exists. If the file is not present, cw will remind you to create it manually instead of creating a Codex-specific host config on your behalf.

## Verification

Before relying on the client integration:

- run `cw doctor`
- run `cw doctor --mcp --host=codex`
- run `cw mcp list-tools`
- run `cw mcp config`

Keep runtime worker and safety settings in `config.json`; use the MCP snippet only for launch wiring, and make sure Codex starts it from the intended workspace root.

`cw mcp list-tools` and `cw mcp config` only validate the local runtime and snippet shape. They do not prove that Codex loaded the snippet. Use `cw doctor --mcp --host=codex` for the host-side check, and do not treat a bare `cw mcp serve` run as a persistent health signal because the stdio server can exit when no client remains attached.
