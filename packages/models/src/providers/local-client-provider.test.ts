import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ModelConfig } from "@mcp-code-worker/core";

interface MockChildProcess extends EventEmitter {
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
  stdinText: string;
}

const { inspectConfiguredLocalClientCommandMock, spawnMock } = vi.hoisted(() => ({
  inspectConfiguredLocalClientCommandMock: vi.fn(),
  spawnMock: vi.fn()
}));

const createMockChildProcess = (): MockChildProcess => {
  const child = new EventEmitter() as MockChildProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdinText = "";
  child.stdin.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    child.stdinText += chunk;
  });
  return child;
};

const waitForSpawn = async (): Promise<void> => {
  await Promise.resolve();
};

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

vi.mock("./local-client-command.js", () => ({
  inspectConfiguredLocalClientCommand: inspectConfiguredLocalClientCommandMock
}));

import { LocalClientProvider } from "./local-client-provider.js";

const config: ModelConfig = {
  provider: "client",
  model: "qwen3-coder"
};

describe("LocalClientProvider", () => {
  beforeEach(() => {
    inspectConfiguredLocalClientCommandMock.mockReset();
    spawnMock.mockReset();
    inspectConfiguredLocalClientCommandMock.mockResolvedValue({
      command: "opencode",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      },
      configuredCommand: null,
      isPathLike: false,
      resolvedPath: "resolved-opencode",
      source: "default",
      status: "pass"
    });
  });

  it("returns text results from client json output", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });
    await waitForSpawn();

    expect(spawnMock).toHaveBeenCalledWith(
      "resolved-opencode",
      [
        "-p",
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
        "--output-format",
        "json",
        "--model",
        "qwen3-coder"
      ],
      {
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello",
        usage: {
          input_tokens: 12,
          output_tokens: 2
        }
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    const result = await pending;

    expect(child.stdinText).toBe("Reply with exactly hello");
    expect(result.text).toBe("hello");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 2
    });
  });

  it("returns structured output when a json schema is requested", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Return JSON",
      systemPrompt: "Only return valid JSON.",
      responseFormat: "json",
      responseSchema: z.object({
        ok: z.boolean(),
        message: z.string()
      })
    });
    await waitForSpawn();

    const args = spawnMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain("--system-prompt");
    expect(args).toContain("Only return valid JSON.");
    expect(args).toContain("--json-schema");
    expect(args.at(-1)).toContain("\"type\":\"object\"");

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ignored",
        structured_output: {
          ok: true,
          message: "hello"
        }
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    const result = await pending;

    expect(result.text).toBe("{\"ok\":true,\"message\":\"hello\"}");
  });

  it("throws when the local client exits with a failure code", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });
    await waitForSpawn();

    child.stdout.end();
    child.stderr.end("authentication failed");
    child.emit("close", 1);

    await expect(pending).rejects.toThrow(
      "Local client worker exited with code 1: authentication failed"
    );
  });

  it("surfaces structured client error output when the local client exits non-zero", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const provider = new LocalClientProvider();
    const pending = provider.invoke(config, {
      prompt: "Reply with exactly hello"
    });
    await waitForSpawn();

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "API Error: Unable to connect to API (ConnectionRefused)"
      })
    );
    child.stderr.end();
    child.emit("close", 1);

    await expect(pending).rejects.toThrow(
      "Local client worker exited with code 1: API Error: Unable to connect to API (ConnectionRefused)"
    );
  });

  it("uses the configured client command override when provided", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    inspectConfiguredLocalClientCommandMock.mockResolvedValueOnce({
      command: "custom-client",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      },
      configuredCommand: "custom-client",
      isPathLike: false,
      resolvedPath: "resolved-custom-client",
      source: "configured",
      status: "pass"
    });

    const provider = new LocalClientProvider();
    const pending = provider.invoke(
      {
        ...config,
        clientCommand: "custom-client"
      },
      {
        prompt: "Reply with exactly hello"
      }
    );
    await waitForSpawn();

    expect(spawnMock.mock.calls[0]?.[0]).toBe("resolved-custom-client");

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello"
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    await pending;
  });

  it("uses the model config client command when configured", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    inspectConfiguredLocalClientCommandMock.mockResolvedValueOnce({
      command: "config-client",
      compatibility: {
        checked: false,
        message: "Command resolution passed.",
        status: "pass"
      },
      configuredCommand: "config-client",
      isPathLike: false,
      resolvedPath: "resolved-config-client",
      source: "configured",
      status: "pass"
    });

    const provider = new LocalClientProvider();
    const pending = provider.invoke(
      {
        ...config,
        clientCommand: "config-client"
      },
      {
        prompt: "Reply with exactly hello"
      }
    );
    await waitForSpawn();

    expect(spawnMock.mock.calls[0]?.[0]).toBe("resolved-config-client");

    child.stdout.end(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello"
      })
    );
    child.stderr.end();
    child.emit("close", 0);

    await pending;
  });

  it("throws a resolution error with configured and resolved command details", async () => {
    inspectConfiguredLocalClientCommandMock.mockResolvedValueOnce({
      command: "sparkcode.exe",
      compatibility: {
        checked: false,
        message: "Local client command 'sparkcode.exe' was not found.",
        status: "fail"
      },
      configuredCommand: "sparkcode.exe",
      isPathLike: false,
      resolvedPath: null,
      source: "configured",
      status: "fail"
    });

    const provider = new LocalClientProvider();

    await expect(
      provider.invoke(
        {
          ...config,
          clientCommand: "sparkcode.exe"
        },
        {
          prompt: "Reply with exactly hello"
        }
      )
    ).rejects.toThrow(
      "Local client command resolution failed: Local client command 'sparkcode.exe' was not found. (configured=sparkcode.exe resolved=(not found) source=configured)"
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
