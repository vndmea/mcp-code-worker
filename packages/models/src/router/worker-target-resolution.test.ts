import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentError, createExecutionContextFromEnv } from "@mcp-code-worker/core";

import {
  requireConfiguredWorkerId,
  resolveWorkerTarget
} from "./worker-target-resolution.js";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "cw-worker-target-"));

describe("worker target resolution", () => {
  it("resolves a configured default worker id without requiring a registry entry", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, {
      defaultWorkerId: "primary-worker",
      rootDir,
      workerModel: {
        provider: "mock",
        model: "gpt-5.4-mini"
      }
    });

    const result = await resolveWorkerTarget({ context });

    expect(result.source).toBe("config-default");
    expect(result.workerId).toBe("primary-worker");
    expect(result.modelConfig.model).toBe("gpt-5.4-mini");
  });

  it("allows ad-hoc named workers when explicit overrides are supplied", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    const result = await resolveWorkerTarget({
      context,
      workerId: "scratch-worker",
      provider: "mock",
      model: "sandbox-worker"
    });

    expect(result.source).toBe("ad-hoc");
    expect(result.workerId).toBe("scratch-worker");
    expect(result.modelConfig.provider).toBe("mock");
    expect(result.modelConfig.model).toBe("sandbox-worker");
  });

  it("requires a named worker when a command depends on persisted worker identity", async () => {
    const rootDir = await createRootDir();
    const context = createExecutionContextFromEnv(undefined, { rootDir });

    expect(() =>
      requireConfiguredWorkerId(context, undefined, "worker profile lookup")
    ).toThrowError(AgentError);
    expect(() =>
      requireConfiguredWorkerId(context, undefined, "worker profile lookup")
    ).toThrow("defaultWorkerId");
  });
});
