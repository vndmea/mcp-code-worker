import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createExecutionContextFromEnv,
  getAoConfigPath
} from "@agent-orchestrator/core";
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

  it("marks missing scripts as not configured", async () => {
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
        status: "not-configured"
      })
    ]);
    expect(result.warnings[0]).toContain("not configured");
  });

  it("uses validation script mappings from ao config", async () => {
    const rootDir = await createRootDir();
    const configPath = getAoConfigPath(rootDir);
    await mkdir(dirname(configPath), { recursive: true });
    await writePackage(rootDir, "package.json", {
      "check-types": "node -e \"process.exit(0)\""
    });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          validation: {
            autoDiscover: false,
            scripts: {
              typecheck: ["check-types"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    const context = createExecutionContextFromEnv(undefined, {
      dryRun: true,
      allowWrite: false,
      rootDir
    });

    const result = await runRepositoryValidation(context, {
      typecheck: true
    });

    expect(result.checks).toEqual([
      expect.objectContaining({
        name: "typecheck",
        status: "dry-run",
        scriptName: "check-types",
        resolutionSource: "configured"
      })
    ]);
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
      const lintCheck = result.checks.find((check) => check.name === "lint");

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
            exitCode: 1
          }),
          expect.objectContaining({
            name: "test",
            status: "success"
          })
        ])
      );
      expect(lintCheck?.diagnosticSummary?.previewLines).toEqual(
        expect.arrayContaining(["lint failed"])
      );
      expect(result.ok).toBe(false);
    },
    15_000
  );
});
