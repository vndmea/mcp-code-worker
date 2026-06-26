import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { createExecutionContextFromEnv } from "@agent-orchestrator/core";
import { runRepositoryValidation } from "@agent-orchestrator/tools";

const createRootDir = async (): Promise<string> =>
  mkdtemp(join(tmpdir(), "ao-validation-"));

const writePackage = async (
  rootDir: string,
  relativePath: string,
  scripts: Record<string, string>
): Promise<void> => {
  const fullPath = join(rootDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify({ scripts }, null, 2), "utf8");
};

describe("runRepositoryValidation", () => {
  it("returns dry-run checks for available scripts", async () => {
    const rootDir = await createRootDir();
    await writePackage(rootDir, "package.json", {
      typecheck: "node -e \"process.exit(0)\""
    });
    const context = createExecutionContextFromEnv(undefined, {
      dryRun: true,
      allowWrite: false,
      rootDir
    });

    const result = await runRepositoryValidation(context, {
      typecheck: true
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "typecheck",
        status: "dry-run"
      })
    ]);
  });

  it("skips missing scripts", async () => {
    const rootDir = await createRootDir();
    await writePackage(rootDir, "package.json", {});
    const context = createExecutionContextFromEnv(undefined, {
      dryRun: true,
      allowWrite: false,
      rootDir
    });

    const result = await runRepositoryValidation(context, {
      lint: true
    });

    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "lint",
        status: "skipped"
      })
    ]);
    expect(result.warnings[0]).toContain("Skipped lint");
  });

  it(
    "runs scoped validation commands in execute mode and propagates output metadata",
    async () => {
      const rootDir = await createRootDir();
      await writePackage(rootDir, "package.json", {});
      await writePackage(rootDir, "packages/pkg/package.json", {
        typecheck: `node -e "process.stdout.write('a'.repeat(121000))"`,
        lint: `node -e "console.error('lint failed'); process.exit(1)"`,
        test: `node -e "console.log('ok')"`
      });
      const context = createExecutionContextFromEnv(undefined, {
        dryRun: false,
        allowWrite: false,
        rootDir
      });

      const result = await runRepositoryValidation(context, {
        typecheck: true,
        lint: true,
        test: true,
        scope: "packages/pkg"
      });

      expect(result.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "typecheck",
            status: "success",
            stdoutTruncated: true
          }),
          expect.objectContaining({
            name: "lint",
            status: "failure",
            exitCode: 1,
            diagnosticSummary: expect.objectContaining({
              previewLines: expect.arrayContaining(["lint failed"])
            })
          }),
          expect.objectContaining({
            name: "test",
            status: "success"
          })
        ])
      );
      expect(result.ok).toBe(false);
    },
    15_000
  );
});
