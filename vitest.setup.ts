import { webcrypto } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

if (!process.env.CW_STORAGE_DIR) {
  process.env.CW_STORAGE_DIR = join(tmpdir(), `cw-vitest-home-${process.pid}`);
}

const cleanupStorageDir = () => {
  const storageDir = process.env.CW_STORAGE_DIR;

  if (!storageDir) {
    return;
  }

  try {
    rmSync(storageDir, {
      force: true,
      recursive: true,
      maxRetries: process.platform === "win32" ? 10 : 0,
      retryDelay: 200
    });
  } catch {
    // Best-effort cleanup for test-only storage.
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
