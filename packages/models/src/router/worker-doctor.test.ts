import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@mcp-code-worker/core";

import { createWorkerDoctorChecks } from "./worker-doctor.js";

describe("worker doctor checks", () => {
  it("composes worker profile and connectivity checks through one entry point", async () => {
    const context = createExecutionContextFromEnv(undefined, {
      rootDir: process.cwd()
    });

    const checks = await createWorkerDoctorChecks(context, {
      includeLocalClient: false,
      includeProfile: false,
      probe: false
    });

    expect(checks).toEqual([]);
  });

  it("does not fail local client checks when an explicit worker cannot be resolved", async () => {
    const context = createExecutionContextFromEnv(undefined, {
      rootDir: process.cwd()
    });

    const checks = await createWorkerDoctorChecks(context, {
      includeProfile: false,
      probe: false,
      workerId: "missing-worker"
    });

    expect(checks).toEqual([]);
  });
});
