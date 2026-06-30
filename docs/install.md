# Installation

The supported end-user install path is the public npm package:

```bash
npm i -g mcp-code-worker
cw doctor
cw mcp list-tools
```

`cw` stores user-scoped local state under `~/.cw/workspaces/<workspace-id>/` by default.

See [docs/supported-matrix.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/supported-matrix.md) before claiming support for a specific OS, Node.js version, or MCP host.

## Recommended npm flow

```bash
npm i -g mcp-code-worker
cw init
cw doctor --probe
cw mcp config
cw mcp serve
```

Notes:

- The published npm package installs the `cw` command.
- Use `cw init` as the default onboarding path. Run it interactively by default, or use presets such as `--preset=mock`, `--preset=deepseek`, or `--preset=opencode` with `--allow-write` when you need the lower-level scripted setup flow.
- Persist worker, validation, safety, local client defaults, and optional provider API keys in `config.json`.
- If Codex is your MCP host, paste `cw mcp config --host=codex` into `~/.codex/config.toml`.
- `cw init --allow-write --write-codex-mcp-config` only updates that file when it already exists. If it is missing, cw leaves a manual reminder instead of creating a new host config silently.
- `cw mcp serve` resolves the workspace from the current directory by default.
- `cw mcp list-tools` and `cw mcp config` only validate the local runtime and recommended snippet shape.
- Use `cw doctor --mcp --host=codex` when you need the host-side wiring check.
- A bare `cw mcp serve` run can exit when stdio closes; that alone does not mean the server is unhealthy.
- Launch MCP clients from the target repository checkout so cwd-based root resolution stays correct.
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
pnpm exec cw init
pnpm exec cw doctor
pnpm exec cw mcp config
pnpm exec cw mcp serve
```

Notes:

- In the development checkout path, `cw ...` means `pnpm exec cw ...` from the repository root.
- Run all `pnpm exec cw ...` commands from the repository root.
- `pnpm --filter=@mcp-code-worker/cli exec cw ...` is not the recommended entrypoint because it changes path resolution semantics.

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
- Use `pnpm exec cw doctor --mcp --host=codex` when you need to verify that a Codex host config actually loaded the snippet.
- The MCP snippet should only describe how to launch `cw`; runtime worker and safety settings should come from `config.json`.
- For workspace-scoped IDE use, start `pnpm exec cw mcp serve` from the target repository root.
- For local client providers, `opencode` is the default command. Persist a different compatible local wrapper with `cw init --worker-client-command=<command> --allow-write`.
- See `docs/distribution.md` for the current publish and development distribution shapes.
