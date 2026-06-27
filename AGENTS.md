# agent-orchestrator agent rules

- Keep TypeScript strict.
- Prefer small packages with clear boundaries.
- Do not build a Codex, OpenCode, Cursor, or Claude Code clone.
- Do not add unnecessary UI.
- Avoid leaking secrets.
- Never hardcode model credentials.
- Use Zod for external and cross-agent data.
- Write tests for workflow logic.
- Keep host/worker responsibilities separated.
- Prefer deterministic tools over model guessing.
- Worker outputs must be reviewed before final acceptance.
- Default to dry-run for file writes and shell execution.
- MCP tools should be thin wrappers around core workflows.
