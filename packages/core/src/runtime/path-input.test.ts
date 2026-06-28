import { describe, expect, it } from "vitest";

import {
  looksLikeFileSystemPath,
  normalizeCommandInput,
  normalizeFileSystemPath
} from "@mcp-code-worker/core";

describe("path input normalization", () => {
  it("normalizes quoted and duplicated Windows separators", () => {
    expect(
      normalizeFileSystemPath("\"C:/Users/test//cw/config.json\"", {
        platform: "win32"
      })
    ).toBe("C:\\Users\\test\\cw\\config.json");
  });

  it("normalizes backslash-heavy relative POSIX paths", () => {
    expect(
      normalizeFileSystemPath(".\\tmp\\\\worker-profiles.json", {
        cwd: "/repo",
        platform: "linux"
      })
    ).toBe("/repo/tmp/worker-profiles.json");
  });

  it("expands home-relative inputs across platforms", () => {
    expect(
      normalizeFileSystemPath("~/cw/config.json", {
        homeDir: "/Users/demo",
        platform: "darwin"
      })
    ).toBe("/Users/demo/cw/config.json");

    expect(
      normalizeFileSystemPath("~\\cw\\config.json", {
        homeDir: "C:\\Users\\demo",
        platform: "win32"
      })
    ).toBe("C:\\Users\\demo\\cw\\config.json");
  });

  it("keeps bare commands untouched while normalizing command paths", () => {
    expect(normalizeCommandInput("opencode")).toBe("opencode");
    expect(
      normalizeCommandInput("\"./bin//opencode\"", {
        cwd: "/repo",
        platform: "linux"
      })
    ).toBe("/repo/bin/opencode");
  });

  it("recognizes common file-system-like values", () => {
    expect(looksLikeFileSystemPath("./bin/opencode")).toBe(true);
    expect(looksLikeFileSystemPath("C:\\tools\\opencode.exe")).toBe(true);
    expect(looksLikeFileSystemPath("opencode")).toBe(false);
  });
});
