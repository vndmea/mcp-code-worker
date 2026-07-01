import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.hoisted(() => vi.fn());

const getAccessCandidates = (): string[] =>
  accessMock.mock.calls.map((call) => {
    const candidate: unknown = call[0];

    if (typeof candidate !== "string") {
      throw new TypeError("Expected access() to be called with a string path");
    }

    return candidate;
  });

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");

  return {
    ...actual,
    access: accessMock
  };
});

describe("resolveCommandOnPath", () => {
  beforeEach(() => {
    accessMock.mockReset();
  });

  it("prefers Windows executable extensions for bare commands before extensionless shims", async () => {
    vi.resetModules();
    vi.stubGlobal("process", {
      ...process,
      platform: "win32"
    });

    accessMock.mockImplementation((candidate: string) =>
      candidate === "C:\\nvm4w\\nodejs\\opencode.CMD"
        ? Promise.resolve(undefined)
        : Promise.reject(new Error(`missing: ${candidate}`))
    );

    const { resolveCommandOnPath } = await import("./local-client-command.js");
    const resolved = await resolveCommandOnPath("opencode", {
      PATH: "C:\\nvm4w\\nodejs",
      PATHEXT: ".COM;.EXE;.BAT;.CMD"
    });

    expect(resolved).toBe("C:\\nvm4w\\nodejs\\opencode.CMD");
    expect(getAccessCandidates()).toEqual([
      "C:\\nvm4w\\nodejs\\opencode.COM",
      "C:\\nvm4w\\nodejs\\opencode.EXE",
      "C:\\nvm4w\\nodejs\\opencode.BAT",
      "C:\\nvm4w\\nodejs\\opencode.CMD"
    ]);
  });

  it("still checks the exact path first for configured path-like commands", async () => {
    vi.resetModules();
    vi.stubGlobal("process", {
      ...process,
      platform: "win32"
    });

    accessMock.mockImplementation((candidate: string) =>
      candidate === "C:\\tools\\claude"
        ? Promise.resolve(undefined)
        : Promise.reject(new Error(`missing: ${candidate}`))
    );

    const { resolveCommandOnPath } = await import("./local-client-command.js");
    const resolved = await resolveCommandOnPath("C:\\tools\\claude", {
      PATH: "C:\\nvm4w\\nodejs",
      PATHEXT: ".COM;.EXE;.BAT;.CMD"
    });

    expect(resolved).toBe("C:\\tools\\claude");
    expect(getAccessCandidates()).toEqual(["C:\\tools\\claude"]);
  });

  it("uses POSIX PATH splitting for bare commands on macOS-like platforms", async () => {
    vi.resetModules();
    vi.stubGlobal("process", {
      ...process,
      platform: "darwin"
    });

    accessMock.mockImplementation((candidate: string) =>
      candidate === "/opt/homebrew/bin/opencode"
        ? Promise.resolve(undefined)
        : Promise.reject(new Error(`missing: ${candidate}`))
    );

    const { resolveCommandOnPath } = await import("./local-client-command.js");
    const resolved = await resolveCommandOnPath("opencode", {
      PATH: "/usr/local/bin:/opt/homebrew/bin"
    });

    expect(resolved).toBe("/opt/homebrew/bin/opencode");
    expect(getAccessCandidates()).toEqual([
      "/usr/local/bin/opencode",
      "/opt/homebrew/bin/opencode"
    ]);
  });
});
