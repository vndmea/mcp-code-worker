# Safety

Default behavior is conservative.

For the concrete permission model and write gates, see `docs/permissions.md`.

- File writes stay in dry-run mode unless policy explicitly allows them.
- Shell execution uses an allowlist.
- Worker outputs require host review before final acceptance.
- Workers should be interviewed before they are trusted with production task routing.
- Benchmarks are a separate coding-ability signal; they do not replace interview onboarding.
- `patch-generation` should only be enabled through an explicit persisted profile update after a qualifying benchmark.
- Workers with weak structured-output or codegen performance are limited or blocked.
- Secrets may come from environment variables or the user-scoped CW `config.json`, and should never be logged.
- MCP tools do not expose unrestricted shell access.
