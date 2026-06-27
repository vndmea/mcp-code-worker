import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  getAoConfigPath,
  getAoWorkspaceAuditDir,
  getAoWorkspaceRunsDir,
  runDoctor
} from "@agent-orchestrator/core";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-doctor-"));

describe("doctor", () => {
  it("works before init and warns about missing config and runs dir", async () => {
    const rootDir = await createWorkspace();
    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir
      })
    );

    expect(report.checks.find((check) => check.name === "ao-config")?.status).toBe("warning");
    expect(report.checks.find((check) => check.name === "runs-dir")?.status).toBe("warning");
  });

  it("fails on invalid config and warns about invalid task sessions", async () => {
    const rootDir = await createWorkspace();
    const runsDir = getAoWorkspaceRunsDir(rootDir);
    await mkdir(join(runsDir, "broken"), { recursive: true });
    await writeFile(
      getAoConfigPath(rootDir),
      JSON.stringify({
        version: 1,
        workerModel: {
          provider: "litellm",
          model: "qwen3-coder",
          baseURL: "not-a-url"
        }
      }),
      "utf8"
    );
    await writeFile(
      join(runsDir, "broken", "session.json"),
      "{\"taskId\":42}",
      "utf8"
    );

    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir,
        workerModel: {
          provider: "litellm",
          model: "qwen3-coder"
        }
      })
    );

    expect(report.checks.find((check) => check.name === "ao-config")?.status).toBe("fail");
    expect(report.checks.find((check) => check.name === "task-sessions")?.status).toBe("warning");
    expect(report.checks.find((check) => check.name === "worker-api-key")?.status).toBe("warning");
  });

  it("passes after init-like setup with retained directories", async () => {
    const rootDir = await createWorkspace();
    await mkdir(getAoWorkspaceRunsDir(rootDir), { recursive: true });
    await mkdir(getAoWorkspaceAuditDir(rootDir), { recursive: true });
    await writeFile(
      getAoConfigPath(rootDir),
      JSON.stringify(
        {
          version: 1,
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
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify(
        {
          scripts: {
            typecheck: "node -e \"process.exit(0)\"",
            lint: "node -e \"process.exit(0)\"",
            test: "node -e \"process.exit(0)\""
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir
      })
    );

    expect(report.checks.find((check) => check.name === "ao-config")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "runs-dir")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "validation-scripts")?.status).toBe("pass");
    expect(report.status).toBe("ready");
    expect(report.summary).toContain("ready:");
    expect(report.recommendedEntrypoints.map((entry) => entry.toolName)).toContain("ao_start_task");
  });

  it("checks the local client command when client providers are configured", async () => {
    const rootDir = await createWorkspace();
    const originalCommand = process.env.AO_WORKER_CLIENT_COMMAND;
    process.env.AO_WORKER_CLIENT_COMMAND = "node";

    try {
      const report = await runDoctor(
        createExecutionContextFromEnv(undefined, {
          rootDir,
          workerModel: {
            provider: "client",
            model: "qwen3-coder"
          }
        })
      );

      expect(
        report.checks.find((check) => check.name === "local-client-command")?.status
      ).toBe("pass");
      expect(
        report.checks.find((check) => check.name === "worker-api-key")?.status
      ).toBe("pass");
    } finally {
      if (originalCommand === undefined) {
        delete process.env.AO_WORKER_CLIENT_COMMAND;
      } else {
        process.env.AO_WORKER_CLIENT_COMMAND = originalCommand;
      }
    }
  });
});
