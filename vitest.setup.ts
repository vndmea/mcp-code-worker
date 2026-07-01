import { webcrypto } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, rmdirSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

type MutableOsModule = {
  tmpdir: () => string;
};

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

const require = createRequire(import.meta.url);
const nodeOs = require("node:os") as MutableOsModule;
const originalHomeDir = process.env.USERPROFILE ?? process.env.HOME ?? homedir();
const testTempRootDir = join(originalHomeDir, ".code-worker", "temp");
const testSessionDir = join(testTempRootDir, `vitest-${process.pid}`);
const testHomeDir = join(testSessionDir, "home");
const testSystemTempDir = join(testSessionDir, "tmp");

mkdirSync(testHomeDir, { recursive: true });
mkdirSync(testSystemTempDir, { recursive: true });

process.env.HOME = testHomeDir;
process.env.USERPROFILE = testHomeDir;
process.env.TMPDIR = testSystemTempDir;
process.env.TEMP = testSystemTempDir;
process.env.TMP = testSystemTempDir;
delete process.env.HOMEDRIVE;
delete process.env.HOMEPATH;

nodeOs.tmpdir = () => testSystemTempDir;
syncBuiltinESMExports();

const cleanupStorageDir = () => {
  try {
    rmSync(testSessionDir, {
      force: true,
      recursive: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      retryDelay: 200
    });
  } catch {
    // Best-effort cleanup for test-only storage.
  }

  try {
    if (readdirSync(testTempRootDir).length === 0) {
      rmdirSync(testTempRootDir);
    }
  } catch {
    // Best-effort cleanup for the shared temp root.
  }
};

process.once("exit", cleanupStorageDir);
process.once("SIGINT", () => {
  cleanupStorageDir();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanupStorageDir();
  process.exit(143);
});
