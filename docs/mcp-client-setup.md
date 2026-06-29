# MCP Client Setup

This document explains how to connect `mcp-code-worker` to MCP-capable hosts and editor clients.

See [docs/supported-matrix.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/supported-matrix.md) for which MCP host categories are currently supported versus documented best-effort.

`cw` is the MCP server entrypoint. The same runtime can be launched from:

- a public npm install (`npm i -g mcp-code-worker`)
- a repository checkout (`pnpm exec cw ...` from the repository root)

## Recommended Setup Pattern

For most clients, the recommended command shape is:

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

Use `cw mcp config` as the copy source for this snippet. The host snippet should only define how to launch `cw`; worker/provider/base URL/local client defaults should live in `config.json`.

When a host has a first-party preset, prefer the host-specific form:

```bash
cw mcp config --host codex
cw mcp config --host cursor
cw mcp config --host vscode
cw mcp config --host claude-desktop
cw mcp config --host opencode
```

Current built-in host presets:

| Host | Built-in behavior |
| ---- | ----------------- |
| `generic` | Minimal stdio snippet |
| `codex` | Minimal stdio snippet |
| `cursor` | Minimal stdio snippet |
| `vscode` | Minimal stdio snippet |
| `claude-desktop` | Minimal stdio snippet |
| `opencode` | Minimal stdio snippet |

If the client launches from a shared tools checkout instead of the active repository, switch it to launch `cw mcp serve` from the intended repository root.

## Validation Before Client Setup

Before connecting any client, verify the runtime locally:

```bash
cw doctor
cw doctor --probe
cw doctor --mcp --host codex
cw mcp list-tools
cw mcp config
```

Use `cw doctor --mcp --host codex` when you want cw to inspect the Codex host config, compare it with the recommended snippet, launch the configured server command, and confirm that the host-visible tool list matches `cw mcp list-tools`.

If you are using a repository checkout instead of the public install path, read every `cw ...` example in this document as `pnpm exec cw ...` from the repository root.

## Root And Storage Notes

- By default, CW-managed state is stored under `~/.cw/workspaces/<workspace-id>/`.

For workspace-scoped editor use, launch `cw mcp serve` from the intended workspace root. If that is not possible, rewire the client launch path instead of injecting workspace overrides through environment variables.

## Local Client Provider Note

If the worker model uses the local client provider, `opencode` is the default compatible client bridge command. Persist a different command through `cw init --worker-client-command <command> --allow-write` or by editing `config.json`.

Example:

```json
{
  "version": 1,
  "workerClientCommand": "/path/to/compatible-client"
}
```

The MCP client snippet stays unchanged:

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

## Project Scope vs Global Scope

- Put MCP configuration into a workspace-scoped host config when the integration should only apply to one repository.
- Put the same snippet into the host's global MCP config when every repository should see `mcp-code-worker`.
- Put repository-specific instruction defaults in `./AGENTS.md`.
- Put cross-repository Codex defaults in `~/.codex/AGENTS.md`.

`cw init` prints the resolved CW storage paths so you can find and manually edit `~/.cw/workspaces/<workspace-id>/config.json` later if needed.

## Client-specific Guides

Use the guide that matches your host or editor:

- [Codex](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-clients/codex.md)
- [OpenCode](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-clients/opencode.md)
- [Claude Desktop](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-clients/claude-desktop.md)
- [Cursor](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-clients/cursor.md)
- [VS Code](https://github.com/vndmea/mcp-code-worker/blob/master/docs/mcp-clients/vscode.md)

Each guide uses the same `cw mcp serve` runtime and explains the minimum configuration and verification loop. Prefer `cw mcp config --host <name>` as the snippet source so the docs and CLI stay aligned.
