# First Task

This guide walks through one small end-to-end task after installation so you can confirm that `cw` is set up correctly before attempting larger workflows.

## Prerequisites

You should already have either:

- a public install: `npm i -g mcp-code-worker`
- or a development checkout where you run `pnpm exec cw ...` from the repository root

Before starting the task:

```bash
cw init
cw doctor
cw mcp config
```

If you are using a repository checkout, read the commands below as `pnpm exec cw ...` from the repository root.

## Task Goal

Start with a narrow reviewable task that does not require repository writes:

```bash
cw task start \
  --goal "Review packages/core and propose safe improvements" \
  --scope packages/core \
  --typecheck \
  --propose-patch \
  --inspect-patch \
  --allow-write-session
```

This task is a good first run because it exercises:

- repository context selection
- deterministic validation
- persisted task artifacts
- patch proposal and inspection without applying writes

## What To Expect

The command returns a `taskId`. Keep it for the follow-up steps.

Then inspect the human-readable report:

```bash
cw task report <taskId>
```

Useful follow-up commands:

```bash
cw task status <taskId>
cw audit list
```

## Where Artifacts Go

By default, task-session artifacts live under:

```text
~/.cw/workspaces/<workspace-id>/runs/<taskId>/
```

Typical artifacts include:

- `report.md`
- `validation-report.json`
- `patch-proposal.json`
- `patch-inspection.json`

## What This First Task Does Not Do

Your first task should **not** apply a patch automatically.

Even if a patch proposal is generated, repository writes remain gated. Patch apply still requires the explicit write and confirmation gates documented in [docs/permissions.md](https://github.com/vndmea/mcp-code-worker/blob/master/docs/permissions.md).

## Optional Next Step: Add A Qualified Worker

If the first task looks good and you want a real worker in the loop next, qualify one first:

```bash
cw worker interview --provider litellm --model qwen3-coder --save
```

Then rerun a task with:

```bash
cw task start \
  --goal "Review packages/core and propose safe improvements" \
  --scope packages/core \
  --worker litellm:qwen3-coder \
  --require-profile \
  --typecheck \
  --propose-patch \
  --inspect-patch \
  --allow-write-session
```
