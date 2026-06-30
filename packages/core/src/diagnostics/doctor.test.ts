import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bootstrapSqliteWorkspaceStore,
  createExecutionContextFromEnv,
  createTaskSession,
  getCwConfigPath,
  getCwWorkspaceDir,
  runDoctor
} from "@mcp-code-worker/core";
import { updateTaskSession } from "../session/task-session-store.js";

const createWorkspace = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-doctor-"));

const findCheck = (
  report: Awaited<ReturnType<typeof runDoctor>>,
  name: string
) => report.checks.find((check) => check.name === name);

describe("doctor", () => {
  it("works before init and warns about missing config and runs dir", async () => {
    const rootDir = await createWorkspace();
    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir
      })
    );

    expect(report.checks.find((check) => check.name === "cw-config")?.status).toBe("warning");
    expect(report.checks.find((check) => check.name === "runs-dir")?.status).toBe("warning");
    const runtimeBootstrapMetadata = findCheck(report, "runtime-bootstrap")?.metadata;

    expect(runtimeBootstrapMetadata?.["configPath"]).toBe(getCwConfigPath(rootDir));
    expect(runtimeBootstrapMetadata?.["cwStorageDir"]).toBe(getCwWorkspaceDir(rootDir));
    expect(runtimeBootstrapMetadata?.["rootDir"]).toBe(rootDir);
  });

  it("fails on invalid config and warns about invalid task sessions", async () => {
    const rootDir = await createWorkspace();
    const sessionContext = createExecutionContextFromEnv(undefined, {
      allowWrite: true,
      dryRun: false,
      rootDir
    });
    const created = await createTaskSession(
      sessionContext,
      {
        goal: "broken",
        scope: "packages/core"
      },
      true
    );
    await updateTaskSession(
      sessionContext,
      {
        ...created.session,
        status: "failed"
      },
      true
    );
    await writeFile(
      getCwConfigPath(rootDir),
      JSON.stringify({
        version: 1,
        workers: [
          {
            workerId: "litellm-qwen",
            provider: "litellm",
            model: "qwen3-coder",
            baseURL: "not-a-url"
          }
        ]
      }),
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

    expect(report.checks.find((check) => check.name === "cw-config")?.status).toBe("fail");
    expect(report.checks.find((check) => check.name === "task-sessions")?.status).toBe("warning");
    expect(report.checks.find((check) => check.name === "worker-api-key")?.status).toBe("warning");
  });

  it("passes after init-like setup with retained directories", async () => {
    const rootDir = await createWorkspace();
    const now = new Date().toISOString();
    await bootstrapSqliteWorkspaceStore(getCwWorkspaceDir(rootDir));
    await writeFile(
      getCwConfigPath(rootDir),
      JSON.stringify(
        {
          version: 2,
          workers: [
            {
              workerId: "mock-local",
              provider: "mock",
              model: "gpt-5.4-mini",
              enabled: true,
              tags: [],
              createdAt: now,
              updatedAt: now
            }
          ]
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
            build: "node -e \"process.exit(0)\"",
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

    expect(report.checks.find((check) => check.name === "cw-config")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "runs-dir")?.status).toBe("pass");
    expect(report.checks.find((check) => check.name === "validation-scripts")?.status).toBe("pass");
    expect(report.status).toBe("ready");
    expect(report.summary).toContain("ready:");
    expect(report.recommendedEntrypoints.map((entry) => entry.toolName)).toContain("cw_start_task");
  });

  it("checks the local client command when client providers are configured", async () => {
    const rootDir = await createWorkspace();
    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir,
        workerModel: {
          provider: "client",
          model: "qwen3-coder",
          clientCommand: "node"
        }
      })
    );

    expect(
      report.checks.find((check) => check.name === "local-client-command")?.status
    ).toBe("warning");
    expect(
      report.checks.find((check) => check.name === "local-client-command")?.message
    ).toContain("worker-aware model layer");
    expect(
      report.checks.find((check) => check.name === "worker-api-key")?.status
    ).toBe("pass");
  });

  it("records cwd-based bootstrap details without environment overrides", async () => {
    const rootDir = await createWorkspace();
    const originalCwd = process.cwd();

    try {
      process.chdir(rootDir);
      const report = await runDoctor(
        createExecutionContextFromEnv(undefined, {
          rootDir
        })
      );

      const rootMetadata = findCheck(report, "root-dir")?.metadata;
      const runtimeBootstrapMetadata = findCheck(report, "runtime-bootstrap")?.metadata;

      expect(rootMetadata?.["rootSource"]).toBe("cwd");
      expect(runtimeBootstrapMetadata?.["cwHomeDir"]).toBe(join(homedir(), ".code-worker"));
      expect(typeof runtimeBootstrapMetadata?.["workspaceId"]).toBe("string");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
