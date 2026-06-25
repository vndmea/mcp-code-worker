import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  aoDoctorTool,
  aoListAuditEventsTool,
  aoRunLeaderWorkerTool
} from "@agent-orchestrator/mcp-server";
import { describe, expect, it } from "vitest";

const withWritableAuditEnv = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const previousAllowWrite = process.env.AO_ALLOW_WRITE;
  const previousDryRun = process.env.AO_DRY_RUN;
  const rootDir = await mkdtemp(join(tmpdir(), "ao-mcp-audit-effects-"));

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

describe("mcp audit side effects", () => {
  it("writes an audit event for ao_run_leader_worker", async () => {
    await withWritableAuditEnv(async () => {
      await aoRunLeaderWorkerTool.execute({
        goal: "Review the repository for workflow regressions"
      });
      const events = await aoListAuditEventsTool.execute({ limit: 20 });

      expect(
        events.some(
          (event) =>
            event.actor === "mcp" && event.tool === "ao_run_leader_worker"
        )
      ).toBe(true);
    });
  });

  it("writes an audit event for ao_doctor", async () => {
    await withWritableAuditEnv(async () => {
      await aoDoctorTool.execute({});
      const events = await aoListAuditEventsTool.execute({ limit: 20 });

      expect(
        events.some((event) => event.actor === "mcp" && event.tool === "ao_doctor")
      ).toBe(true);
    });
  });
});
