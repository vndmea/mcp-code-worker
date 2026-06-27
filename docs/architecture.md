# Architecture

`mcp-code-worker` is an orchestration runtime built as a pnpm monorepo.

## Package map

- `packages/core`: shared contracts, schemas, policies, and execution context
- `packages/models`: model providers and worker routing
- `packages/graph`: LangGraph-based workflows, host-managed execution, and agent logic
- `packages/tools`: deterministic engineering tool wrappers
- `packages/mcp-server`: MCP transport and tool bindings
- `packages/cli`: the `cw` CLI

## Text diagram

```text
Human / Codex / CI / MCP Client
            |
            v
        CLI or MCP
            |
            v
   Orchestration Runtime
      |            |        \
      v            v         v
 Worker Routing  Deterministic Tools  CW Storage / Artifacts
      |
      v
 Worker Models / Local Clients
```
