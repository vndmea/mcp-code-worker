# Installation

The current internal-trial install method is a workspace checkout of this repository.

Supported path for fresh-machine setup:

```bash
pnpm install
pnpm build
pnpm exec ao doctor
pnpm exec ao mcp list-tools
```

This route has been verified from the repository root after `pnpm build`.

## Recommended Internal-Trial Flow

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec ao init --allow-write
pnpm exec ao doctor
pnpm exec ao mcp config
pnpm exec ao mcp serve
```

Notes:

- Run all `pnpm exec ao ...` commands from the repository root.
- `pnpm --filter @agent-orchestrator/cli exec ao ...` is not the recommended entrypoint because it changes path resolution semantics.
- The repository is still private and does not yet document a supported global install, internal npm registry release, or Docker distribution as the primary trial path.

## Direct Fallback

If the local bin shim is unavailable, call the built CLI directly:

```bash
node packages/cli/dist/main.js doctor
node packages/cli/dist/main.js mcp list-tools
```

## PowerShell Example

```powershell
pnpm install
pnpm build
pnpm exec ao doctor
pnpm exec ao mcp serve
```

## MCP Client Notes

- MCP clients should launch the server from the repository root.
- Use `pnpm exec ao mcp config` to print a stdio config snippet.
- For workspace-scoped IDE use, prefer `pnpm exec ao mcp config --root ${workspaceFolder}` or set `AO_ROOT_DIR` in the MCP server environment.
- For internal trial, prefer the workspace checkout over hardcoded developer-local absolute paths.
