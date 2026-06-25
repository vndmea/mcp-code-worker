import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import * as models from "@agent-orchestrator/models";
import {
  runFixErrorWorkflow,
  runPatchProposalWorkflow
} from "@agent-orchestrator/graph";

const createWorkspace = async (): Promise<string> => {
  const rootDir = await mkdtemp(join(tmpdir(), "ao-patch-proposal-"));
  await mkdir(join(rootDir, "packages", "core", "src"), { recursive: true });
  await writeFile(
    join(rootDir, "packages", "core", "package.json"),
    JSON.stringify(
      {
        scripts: {
          typecheck: "node -e \"process.exit(0)\""
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(rootDir, "packages", "core", "src", "index.ts"),
    "export const value = 1;\n",
    "utf8"
  );
  return rootDir;
};

const createContext = (rootDir: string) =>
  createExecutionContextFromEnv(undefined, {
    rootDir,
    dryRun: true,
    allowWrite: false
  });

describe("patch proposal workflow", () => {
  it("returns a structured proposal with inspection", async () => {
    const rootDir = await createWorkspace();

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core",
      errorLog: "TS2304: Cannot find name 'missingValue'."
    });

    expect(result.proposal.id).toBeTruthy();
    expect(result.proposal.unifiedDiff).toContain("diff --git");
    expect(result.inspection.files.length).toBeGreaterThan(0);
  });

  it("marks fallback proposals as blocked when model output is invalid", async () => {
    const rootDir = await createWorkspace();
    const invokeStructuredSpy = vi
      .spyOn(models, "invokeStructured")
      .mockResolvedValue({
        ok: false,
        rawText: "",
        raw: undefined,
        attempts: 1,
        errors: ["schema validation failed"]
      });

    const result = await runPatchProposalWorkflow({
      context: createContext(rootDir),
      goal: "Fix the failing typecheck",
      scope: "packages/core"
    });

    expect(result.inspection.ok).toBe(false);
    expect(result.warnings[0]).toContain("fell back");
    expect(result.inspection.blockedReasons).toContain("schema validation failed");

    invokeStructuredSpy.mockRestore();
  });
});

describe("fix workflow patch integration", () => {
  it("does not generate patch proposals by default", async () => {
    const rootDir = await createWorkspace();

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      scope: "packages/core"
    });

    expect(result.patchProposal).toBeUndefined();
    expect(result.patchInspection).toBeUndefined();
  });

  it("includes patch proposal output when requested", async () => {
    const rootDir = await createWorkspace();

    const result = await runFixErrorWorkflow({
      context: createContext(rootDir),
      errorLog: "TS2304: Cannot find name 'missingValue'.",
      scope: "packages/core",
      proposePatch: true
    });

    expect(result.patchProposal?.unifiedDiff).toContain("diff --git");
    expect(result.patchInspection).toBeDefined();
  });
});
