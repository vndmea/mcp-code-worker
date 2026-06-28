# Distribution Strategy

`mcp-code-worker` now supports a public npm distribution path for the CLI.

## Supported npm install path

Users can install the CLI globally with:

```bash
npm i -g mcp-code-worker
cw doctor
```

The published package exposes the `cw` command and bundles internal workspace packages into the CLI build output.

When `cw` runs outside a repository checkout, prefer setting:

```bash
CW_ROOT_DIR=/path/to/project
```

so `cw mcp serve` still resolves the intended workspace.

## Development distribution shape

The repository checkout remains the recommended development path:

1. clone this repository
2. `pnpm install`
3. `pnpm build`
4. `pnpm exec cw ...` from the repository root

This route keeps workspace path resolution, tests, and local development behavior aligned with the monorepo.

## Publish implementation notes

- The source workspace package remains `@mcp-code-worker/cli`.
- The published npm package is generated into `packages/cli/.publish/`.
- The published manifest is rewritten to:
  - rename the package to `mcp-code-worker`
  - drop internal `workspace:*` dependencies
  - keep third-party runtime dependencies as normal npm dependencies

## Validation

Before publishing:

```bash
pnpm build
pnpm smoke:pack
pnpm smoke:dist
```
