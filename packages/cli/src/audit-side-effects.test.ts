import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCli } from "@agent-orchestrator/cli";
import { listAuditEvents } from "@agent-orchestrator/core";
import { describe, expect, it } from "vitest";

const createIo = () => {
  const output: string[] = [];
  const errors: string[] = [];

  return {
    output,
    errors,
    io: {
      write: (message: string) => {
        output.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      }
    }
  };
};

const withWritableAuditEnv = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const previousAllowWrite = process.env.AO_ALLOW_WRITE;
  const previousDryRun = process.env.AO_DRY_RUN;
  const rootDir = await mkdtemp(join(tmpdir(), "ao-cli-audit-effects-"));

  try {
    process.chdir(rootDir);
    process.env.AO_ALLOW_WRITE = "true";
    process.env.AO_DRY_RUN = "false";
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);

    if (previousAllowWrite === undefined) {
      delete process.env.AO_ALLOW_WRITE;
    } else {
      process.env.AO_ALLOW_WRITE = previousAllowWrite;
    }

    if (previousDryRun === undefined) {
      delete process.env.AO_DRY_RUN;
    } else {
      process.env.AO_DRY_RUN = previousDryRun;
    }
  }
};

describe("cli audit side effects", () => {
  it("writes an audit event for doctor", async () => {
    await withWritableAuditEnv(async (rootDir) => {
      const { io } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync(["node", "ao", "doctor"]);
      const events = await listAuditEvents(rootDir, 20);

      expect(
        events.some(
          (event) => event.actor === "cli" && event.action === "doctor"
        )
      ).toBe(true);
    });
  });

  it("writes an audit event for leader-worker runs", async () => {
    await withWritableAuditEnv(async (rootDir) => {
      const { io } = createIo();
      const cli = buildCli(io);

      await cli.parseAsync([
        "node",
        "ao",
        "run",
        "leader-worker-workflow",
        "--goal",
        "Review the repository for workflow regressions",
        "--allow-write"
      ]);
      const events = await listAuditEvents(rootDir, 50);

      expect(
        events.some(
          (event) =>
            event.actor === "cli" &&
            event.action === "run-workflow" &&
            event.workflow === "leader-worker-workflow"
        )
      ).toBe(true);
    });
  });
});
