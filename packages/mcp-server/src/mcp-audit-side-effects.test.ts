import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  cwDoctorTool,
  cwRegisterWorkerTool,
  cwListAuditEventsTool,
  cwRunHostWorkerTool
} from "@mcp-code-worker/mcp-server";
import { getCwWorkspaceFilePath } from "@mcp-code-worker/core";
import { describe, expect, it } from "vitest";

const withWritableAuditWorkspace = async (
  callback: (rootDir: string) => Promise<void>
): Promise<void> => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(join(tmpdir(), "cw-mcp-audit-effects-"));

  try {
    process.chdir(rootDir);
    await callback(rootDir);
  } finally {
    process.chdir(originalCwd);
  }
};

describe("mcp audit side effects", () => {
  it("writes an audit event for cw_run_host_worker", async () => {
    await withWritableAuditWorkspace(async (rootDir) => {
      const workerId = "audit-worker";
      const configPath = getCwWorkspaceFilePath(rootDir, "config.json");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            version: 1,
            safety: {
              dryRun: false,
              allowWrite: true,
              allowedCommands: ["git", "node", "pnpm"]
            },
            workerModel: {
              provider: "mock",
              model: "gpt-5.4-mini"
            }
          },
          null,
          2
        ),
        "utf8"
      );
      await cwRegisterWorkerTool.execute({
        workerId,
        provider: "mock",
        model: "gpt-5.4-mini",
        allowWrite: true
      });
      await cwRunHostWorkerTool.execute({
        goal: "Review the repository for workflow regressions",
        taskType: "review-lite",
        workerId
      });
      const events = await cwListAuditEventsTool.execute({ limit: 20 });

      expect(
        events.some(
          (event) =>
            event.actor === "mcp" && event.tool === "cw_run_host_worker"
        )
      ).toBe(true);
    });
  });

  it("writes an audit event for cw_doctor", async () => {
    await withWritableAuditWorkspace(async (rootDir) => {
      const configPath = getCwWorkspaceFilePath(rootDir, "config.json");
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            version: 1,
            safety: {
              dryRun: false,
              allowWrite: true,
              allowedCommands: ["git", "node", "pnpm"]
            }
          },
          null,
          2
        ),
        "utf8"
      );
      await cwDoctorTool.execute({});
      const events = await cwListAuditEventsTool.execute({ limit: 20 });

      expect(
        events.some((event) => event.actor === "mcp" && event.tool === "cw_doctor")
      ).toBe(true);
    });
  });
});
