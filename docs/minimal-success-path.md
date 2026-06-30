# Minimal Success Path

If you are new to `cw`, use this five-step path instead of learning every low-level tool first.

1. Bind the current repository and inspect readiness.

```bash
cw init
cw doctor
```

If you already know the worker shape you want, the shortest scripted paths are:

```bash
cw init --preset=mock --allow-write
cw init --preset=deepseek --allow-write
cw init --preset=client --allow-write
cw init --preset=opencode --allow-write
cw init --preset=claudecode --allow-write
cw init --preset=codex --allow-write
```

2. Verify model access and credentials.

- Confirm the active `rootDir` matches your repository.
- Confirm the resolved worker model is the one you expect.
- If a non-mock provider is configured, make sure the expected API key is persisted in the user-scoped `config.json`.

3. Start a dry-run task first.

```bash
cw task start --goal="Review this repository" --worker=<workerId>
```

4. Read the report before taking the next step.

- For temporary sessions, read the inline `reportPreview` and `readinessSummary`.
- For persisted sessions, run `cw task report <taskId>`.

5. Decide whether to continue into patch work.

```bash
cw task resume <taskId> --propose-patch --inspect-patch
```

Only enable repository writes after you have manually reviewed the stored report and patch proposal.
