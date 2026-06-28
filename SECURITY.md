# Security

## Scope

`mcp-code-worker` is a local execution runtime with explicit read, session-write, project-write, patch-apply, and audit-write boundaries. Security review for this project should focus on:

- repository read boundaries
- secret handling
- worker routing and qualification
- patch application gates
- shell command allowlisting

## Supported Security Expectations

The documented security model includes:

- dry-run by default
- explicit write gates for repository mutations
- host review before worker outputs are treated as final
- secret-like repository files blocked from ordinary context selection
- user-scoped CW state kept outside the repository checkout by default

See [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md) for the concrete permission layers.

## Reporting A Security Issue

Do not open a public issue with raw secrets, bearer tokens, exploit payloads, or machine-specific sensitive data.

When reporting a security issue:

1. Prepare a minimal reproduction with secrets removed.
2. Describe the impacted command or workflow.
3. Include the relevant version, Node.js version, and whether the runtime was launched via npm install or repository checkout.
4. Request a private reporting path if the issue cannot be shared safely in public.

If no private intake channel is available yet, open a minimal public issue without exploit details and ask maintainers for a secure follow-up path.

## Hardening Guidance For Operators

- API keys may be provided through `WORKER_MODEL_API_KEY` or persisted in the user-scoped CW `config.json`.
- Do not commit provider secrets into repository files, and never paste real keys into issues, logs, or shared transcripts.
- Review patch proposals before any apply attempt.
- Use `--require-profile` for higher-trust worker routing scenarios.
- Validate `CW_ROOT_DIR` and `CW_HOME_DIR` intentionally in shared environments.
