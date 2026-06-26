import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv, runDoctor } from "@agent-orchestrator/core";

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
    await mkdir(join(rootDir, ".ao", "runs", "broken"), { recursive: true });
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify({
        version: 1,
        leaderModel: {
          provider: "litellm",
          model: "qwen3-coder",
          apiKeyEnvVar: "bad-name"
        }
      }),
      "utf8"
    );
    await writeFile(
      join(rootDir, ".ao", "runs", "broken", "session.json"),
      "{\"taskId\":42}",
      "utf8"
    );

    const report = await runDoctor(
      createExecutionContextFromEnv(undefined, {
        rootDir,
        leaderModel: {
          provider: "litellm",
          model: "qwen3-coder"
        }
      })
    );

    expect(report.checks.find((check) => check.name === "ao-config")?.status).toBe("fail");
    expect(report.checks.find((check) => check.name === "task-sessions")?.status).toBe("warning");
    expect(report.checks.find((check) => check.name === "leader-api-key")?.status).toBe("warning");
  });

  it("passes after init-like setup with retained directories", async () => {
    const rootDir = await createWorkspace();
    await mkdir(join(rootDir, ".ao", "runs"), { recursive: true });
    await mkdir(join(rootDir, ".ao", "audit"), { recursive: true });
    await writeFile(
      join(rootDir, ".ao", "config.json"),
      JSON.stringify(
        {
          version: 1,
          leaderModel: {
            provider: "mock",
            model: "gpt-5.4"
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
});
