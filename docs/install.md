# Installation

The supported end-user install path is the public npm package:

```bash
npm i -g mcp-code-worker
cw doctor
cw mcp list-tools
```

`cw` stores user-scoped local state under `~/.cw/workspaces/<workspace-id>/` by default. Use `CW_HOME_DIR` if you need a non-default CW home root.

## Recommended npm flow

```bash
npm i -g mcp-code-worker
cw setup --allow-write
cw doctor
cw mcp config
cw mcp serve
```

Notes:

- The published npm package installs the `cw` command.
- `cw mcp serve` resolves the workspace from the current directory by default.
- When launching outside the target repository checkout, set `CW_ROOT_DIR` for the MCP client process.
- Repository-local legacy `.cw/` directories are unsupported and ignored by current builds.

## Development checkout flow

For local development on this repository, use the workspace checkout path:

```bash
pnpm install
pnpm build
pnpm exec cw doctor
pnpm exec cw mcp list-tools
```

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec cw setup --allow-write
pnpm exec cw doctor
pnpm exec cw mcp config
pnpm exec cw mcp serve
```

Notes:

- In the development checkout path, `cw ...` means `pnpm exec cw ...` from the repository root.
- Run all `pnpm exec cw ...` commands from the repository root.
- `pnpm --filter @mcp-code-worker/cli exec cw ...` is not the recommended entrypoint because it changes path resolution semantics.

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
pnpm exec cw doctor
pnpm exec cw mcp serve
```

## MCP Client Notes

- MCP clients should launch the server from the repository root.
- Use `pnpm exec cw mcp config` to print a stdio config snippet.
- For workspace-scoped IDE use, start `pnpm exec cw mcp serve` from the target repository root, or set `CW_ROOT_DIR` in the MCP server environment when the client launches from elsewhere.
- For local client providers, `opencode` is the default command. Persist a different compatible local wrapper with `cw setup --worker-client-command <command> --allow-write`.
- For cross-checkout or shared-tool setups, also decide whether `CW_HOME_DIR` should be fixed so CW-managed artifacts land in a predictable user-scoped location.
- See `docs/distribution.md` for the current publish and development distribution shapes.
